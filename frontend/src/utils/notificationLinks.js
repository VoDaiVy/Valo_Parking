const CUSTOMER_DEEP_LINKS = [
  '/customer/membership-transfer-marketplace',
  '/customer/membership-transfers',
  '/customer/booking',
  '/customer/wallet',
  '/customer/rewards',
];

export function getSafeCustomerNotificationLink(notification) {
  const rawLink = notification?.metadata?.deepLink;
  if (typeof rawLink === 'string' && rawLink.startsWith('/') && !rawLink.startsWith('//')) {
    try {
      const parsed = new URL(rawLink, window.location.origin);
      const isMarketplaceDetail = /^\/customer\/membership-transfer-marketplace\/[a-f\d]{24}$/i.test(
        parsed.pathname
      );
      const allowed = isMarketplaceDetail || CUSTOMER_DEEP_LINKS.includes(parsed.pathname);
      if (parsed.origin === window.location.origin && allowed) {
        return `${parsed.pathname}${parsed.search}`;
      }
    } catch {
      // Fall through to the typed notification fallback.
    }
  }

  const eventType = String(notification?.metadata?.eventType || '');
  if (eventType === 'LOYALTY_POINTS_EARNED') return '/customer/rewards';
  if (eventType.startsWith('MEMBERSHIP_TRANSFER_')) {
    const transferId = notification?.metadata?.transferId;
    return transferId
      ? `/customer/membership-transfers?tab=marketplace&transferId=${encodeURIComponent(transferId)}`
      : '/customer/membership-transfers?tab=marketplace';
  }
  if (notification?.type === 'BOOKING') {
    const bookingId = notification?.metadata?.bookingId;
    return bookingId
      ? `/customer/booking?bookingId=${encodeURIComponent(bookingId)}`
      : '/customer/booking';
  }
  return null;
}
