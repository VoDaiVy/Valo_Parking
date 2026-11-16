const CUSTOMER_DEEP_LINKS = [
  '/customer/membership-transfer-marketplace',
  '/customer/membership-transfers',
  '/customer/booking',
  '/customer/wallet',
  '/customer/rewards',
];

const MEMBERSHIP_STATUS_EVENTS = new Set([
  'VIP_EXPIRING_SOON', 'VIP_EXPIRED',
  'SUBSCRIPTION_EXPIRING_SOON', 'SUBSCRIPTION_EXPIRED',
  'SUBSCRIPTION_RENEWED', 'SUBSCRIPTION_RENEWAL_SUCCESS', 'SUBSCRIPTION_RENEWAL_FAILED',
  'MEMBERSHIP_ENTITLEMENT_EXPIRING_SOON', 'MEMBERSHIP_ENTITLEMENT_EXPIRED',
  'MEMBERSHIP_ENTITLEMENT_RENEWED', 'MEMBERSHIP_ENTITLEMENT_RENEWAL_SUCCESS',
  'MEMBERSHIP_ENTITLEMENT_RENEWAL_FAILED',
]);

export function getSafeCustomerNotificationLink(notification) {
  const metadata = notification?.metadata || {};
  const validId = (value) => typeof value === 'string' && /^[a-f\d]{24}$/i.test(value);
  const eventType = String(metadata.eventType || '').trim().toUpperCase();
  if (MEMBERSHIP_STATUS_EVENTS.has(eventType)) {
    if (validId(metadata.entitlementId)) return `/customer/membership-transfers?entitlementId=${metadata.entitlementId}`;
    if (validId(metadata.subscriptionId)) return `/customer/membership-transfers?subscriptionId=${metadata.subscriptionId}`;
    // Older notifications without an object cannot open an invented detail.
  }
  if (String(notification?.type).toUpperCase() === 'BOOKING' && validId(metadata.bookingId)) {
    return `/customer/booking?bookingId=${metadata.bookingId}`;
  }
  const rawLink = notification?.metadata?.deepLink;
  if (typeof rawLink === 'string' && rawLink.startsWith('/') && !rawLink.startsWith('//')) {
    try {
      const parsed = new URL(rawLink, window.location.origin);
      if (parsed.origin !== window.location.origin) throw new Error('External notification link');
      const isMarketplaceDetail = /^\/customer\/membership-transfer-marketplace\/[a-f\d]{24}$/i.test(
        parsed.pathname
      );
      let allowed = isMarketplaceDetail || CUSTOMER_DEEP_LINKS.includes(parsed.pathname);
      if (parsed.pathname === '/customer/membership-transfers') {
        // Canonicalize legacy links: a stale tab=marketplace must not hide
        // the requested My Membership detail behind a different screen.
        const entitlementId = parsed.searchParams.get('entitlementId');
        const subscriptionId = parsed.searchParams.get('subscriptionId');
        if (validId(entitlementId)) return `/customer/membership-transfers?entitlementId=${entitlementId}`;
        if (validId(subscriptionId)) return `/customer/membership-transfers?subscriptionId=${subscriptionId}`;
        allowed = false;
      }
      if (parsed.pathname === '/customer/booking') {
        const bookingId = parsed.searchParams.get('bookingId');
        if (validId(bookingId)) return `/customer/booking?bookingId=${bookingId}`;
        allowed = false;
      }
      if (parsed.origin === window.location.origin && allowed) {
        return `${parsed.pathname}${parsed.search}`;
      }
    } catch {
      // Fall through to the typed notification fallback.
    }
  }

  // Open the existing My Membership screen, which loads current ownership.
  // A historical notification is not itself a current entitlement snapshot.
  if (MEMBERSHIP_STATUS_EVENTS.has(eventType)) return null;
  if (eventType === 'LOYALTY_POINTS_EARNED') return '/customer/rewards';
  if (eventType.startsWith('MEMBERSHIP_TRANSFER_')) {
    const transferId = notification?.metadata?.transferId;
    return validId(transferId)
      ? `/customer/membership-transfers?tab=marketplace&transferId=${encodeURIComponent(transferId)}`
      : null;
  }
  if (notification?.type === 'BOOKING') {
    const bookingId = notification?.metadata?.bookingId;
    return validId(bookingId)
      ? `/customer/booking?bookingId=${encodeURIComponent(bookingId)}`
      : null;
  }
  return null;
}
