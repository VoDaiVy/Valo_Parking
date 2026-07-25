import type { UserNotification } from '@/types/models';
import {
  formatNotificationTimestamp,
  getNotificationNavigationTarget,
  matchesNotificationFilter,
} from '@/utils/notifications';

const baseNotification: UserNotification = {
  id: '1',
  title: 'Title',
  content: 'Content',
  type: 'BOOKING',
  priority: 'INFO',
  isRead: false,
  createdAt: '2026-07-08T03:00:00.000Z',
};

describe('notifications utilities', () => {
  it('filters unread, read, and type filters correctly', () => {
    expect(matchesNotificationFilter(baseNotification, 'ALL')).toBe(true);
    expect(matchesNotificationFilter(baseNotification, 'UNREAD')).toBe(true);
    expect(matchesNotificationFilter(baseNotification, 'READ')).toBe(false);
    expect(matchesNotificationFilter(baseNotification, 'BOOKING')).toBe(true);
    expect(matchesNotificationFilter(baseNotification, 'WALLET')).toBe(false);
  });

  it('uses absolute timestamp for old notifications', () => {
    expect(formatNotificationTimestamp(baseNotification.createdAt, new Date('2026-07-10T03:00:00.000Z'))).toContain('08/07/2026');
  });

  it('maps membership marketplace metadata to a strict internal route', () => {
    expect(getNotificationNavigationTarget({
      ...baseNotification,
      type: 'SYSTEM',
      metadata: {
        eventType: 'MEMBERSHIP_TRANSFER_LISTED',
        deepLink: '/customer/membership-transfer-marketplace/transfer-123',
      },
    })).toEqual({
      tab: 'WalletTab',
      screen: 'MembershipMarketplaceDetail',
      params: { transferId: 'transfer-123' },
    });
  });

  it('routes claimed and completed membership events to membership history', () => {
    for (const eventType of [
      'MEMBERSHIP_TRANSFER_CLAIMED',
      'MEMBERSHIP_TRANSFER_COMPLETED',
    ]) {
      expect(
        getNotificationNavigationTarget({
          ...baseNotification,
          metadata: {
            eventType,
            transferId: '507f1f77bcf86cd799439011',
            deepLink: '/customer/membership-transfers',
          },
        }),
      ).toEqual({
        tab: 'WalletTab',
        screen: 'Membership',
      });
    }
  });

  it('ignores unknown external deep links', () => {
    expect(getNotificationNavigationTarget({
      ...baseNotification,
      type: 'SYSTEM',
      metadata: { deepLink: 'https://example.com/not-trusted' },
    })).toBeNull();
  });
});

