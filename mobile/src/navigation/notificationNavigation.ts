import { createNavigationContainerRef, type ParamListBase } from '@react-navigation/native';
import type { UserNotification } from '@/types/models';
import { getNotificationNavigationTarget, isMembershipServiceNotification, getMembershipServiceNotificationParams } from '@/utils/notifications';

export const navigationRef = createNavigationContainerRef<ParamListBase>();
let pending: { item: UserNotification; role?: string } | null = null;
export function clearPendingNotification() { pending = null; }

export function flushPendingNotification() {
  if (!pending || !navigationRef.isReady()) return;
  const next = pending;
  pending = null;
  openNotification(next.item, next.role);
}

export function openNotification(item: UserNotification, role?: string) {
  if (!navigationRef.isReady()) { pending = { item, role }; return; }
  if (role === 'staff') {
    if (isMembershipServiceNotification(item)) {
      navigationRef.navigate('Manage', { screen: 'MembershipServices', params: getMembershipServiceNotificationParams(item) });
      return;
    }
    const screen =
      item.type === 'BOOKING'
        ? 'Bookings'
        : item.type === 'VIOLATION' || item.type === 'CAMERA'
          ? 'ParkingOperations'
          : 'Inbox';
    navigationRef.navigate('Manage', { screen });
    return;
  }
  const target = getNotificationNavigationTarget(item);
  if (!target) {
    navigationRef.navigate('NotificationsTab', { screen: 'Notifications' });
    return;
  }
  navigationRef.navigate(target.tab, {
    screen: target.screen,
    params: 'params' in target ? target.params : undefined,
  });
}
