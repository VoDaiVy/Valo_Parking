import { format, formatDistanceToNow } from 'date-fns';
import { enGB } from 'date-fns/locale';

import { colors } from '@/theme';
import type { NotificationPriority, NotificationType, UserNotification } from '@/types/models';

export type NotificationFilter = 'ALL' | 'UNREAD' | 'READ' | NotificationType;

export const NOTIFICATION_TYPES: NotificationType[] = [
  'SYSTEM',
  'PARKING',
  'BOOKING',
  'WALLET',
  'PAYMENT',
  'ACCOUNT',
  'PROMOTION',
  'CAMERA',
  'VIOLATION',
];

export const getNotificationIcon = (type: NotificationType) =>
  ({
    SYSTEM: '!',
    PARKING: 'P',
    BOOKING: 'B',
    WALLET: 'W',
    PAYMENT: '$',
    ACCOUNT: 'A',
    PROMOTION: '%',
    CAMERA: 'C',
    VIOLATION: 'V',
  })[type];

export const getNotificationColor = (priority: NotificationPriority) =>
  ({
    INFO: colors.primary[500],
    SUCCESS: colors.success.main,
    WARNING: colors.warning.main,
    ERROR: colors.error.main,
    SYSTEM: colors.secondary[500],
  })[priority];

export const formatNotificationTimestamp = (createdAt: string, now = new Date()) => {
  const date = new Date(createdAt);
  const diff = now.getTime() - date.getTime();
  if (diff < 24 * 60 * 60 * 1000) {
    return formatDistanceToNow(date, { addSuffix: true, locale: enGB });
  }
  return format(date, 'HH:mm dd/MM/yyyy', { locale: enGB });
};

export const getNotificationId = (item: UserNotification) => item.id || item._id || item.notificationId || '';

export const matchesNotificationFilter = (item: UserNotification, filter: NotificationFilter) => {
  if (filter === 'ALL') return true;
  if (filter === 'UNREAD') return !item.isRead;
  if (filter === 'READ') return item.isRead;
  return item.type === filter;
};

export type NotificationNavigationTarget =
  | { tab: 'Bookings'; screen: 'BookingDetail'; params: { bookingId: string } }
  | {
      tab: 'WalletTab';
      screen: 'MembershipMarketplaceDetail';
      params: { transferId: string };
    }
  | { tab: 'WalletTab'; screen: 'Membership' }
  | { tab: 'WalletTab'; screen: 'Wallet' }
  | { tab: 'ProfileTab'; screen: 'Profile' };

const getMarketplaceTransferId = (metadata: Record<string, unknown>) => {
  const isListingEvent = metadata.eventType === 'MEMBERSHIP_TRANSFER_LISTED';
  if (
    isListingEvent &&
    typeof metadata.transferId === 'string' &&
    metadata.transferId.trim()
  ) {
    return metadata.transferId.trim();
  }

  if (typeof metadata.deepLink !== 'string') return null;

  const normalized = metadata.deepLink
    .trim()
    .replace(/^valo:\/\//i, '/')
    .split(/[?#]/, 1)[0];
  const match = normalized.match(
    /\/(?:customer\/)?(?:membership-transfer-marketplace|membership-marketplace)\/([a-zA-Z0-9_-]+)\/?$/,
  );
  return match?.[1] ?? null;
};

export const getNotificationNavigationTarget = (item: UserNotification) => {
  const metadata = item.metadata || {};
  if (
    metadata.eventType === 'MEMBERSHIP_TRANSFER_CLAIMED' ||
    metadata.eventType === 'MEMBERSHIP_TRANSFER_COMPLETED'
  ) {
    return {
      tab: 'WalletTab',
      screen: 'Membership',
    } satisfies NotificationNavigationTarget;
  }
  const transferId = getMarketplaceTransferId(metadata);
  if (transferId) {
    return {
      tab: 'WalletTab',
      screen: 'MembershipMarketplaceDetail',
      params: { transferId },
    } satisfies NotificationNavigationTarget;
  }
  if (item.type === 'BOOKING' && typeof metadata.bookingId === 'string') {
    return {
      tab: 'Bookings',
      screen: 'BookingDetail',
      params: { bookingId: metadata.bookingId },
    } satisfies NotificationNavigationTarget;
  }
  if (item.type === 'WALLET' || item.type === 'PAYMENT') {
    return { tab: 'WalletTab', screen: 'Wallet' } satisfies NotificationNavigationTarget;
  }
  if (item.type === 'ACCOUNT') {
    return { tab: 'ProfileTab', screen: 'Profile' } satisfies NotificationNavigationTarget;
  }
  return null;
};

