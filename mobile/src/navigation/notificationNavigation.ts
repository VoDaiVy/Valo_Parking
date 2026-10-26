import { createNavigationContainerRef, type ParamListBase } from '@react-navigation/native';
import type { UserNotification } from '@/types/models';
import { getNotificationNavigationTarget } from '@/utils/notifications';

export const navigationRef = createNavigationContainerRef<ParamListBase>();

export function openNotification(item: UserNotification, role?: string) {
  if (!navigationRef.isReady()) return;
  if (role === 'staff' || role === 'admin') {
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
