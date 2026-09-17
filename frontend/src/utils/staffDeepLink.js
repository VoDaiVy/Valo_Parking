export const getSafeStaffDeepLink = (notification) => {
  if (!notification) return null;

  const rawLink = notification?.metadata?.deepLink;
  if (typeof rawLink === 'string' && rawLink.startsWith('/') && !rawLink.startsWith('//')) {
    try {
      const parsed = new URL(rawLink, window.location.origin);
      if (parsed.origin === window.location.origin && parsed.pathname.startsWith('/staff/')) {
        // Exclude gate control from notifications
        if (!parsed.pathname.startsWith('/staff/gate')) {
          return `${parsed.pathname}${parsed.search}`;
        }
      }
    } catch {
      // Fall through
    }
  }

  const eventType = String(notification?.metadata?.eventType || '');
  const type = notification?.type || '';

  // Booking
  if (type === 'BOOKING' || eventType.includes('BOOKING')) {
    const bookingId = notification?.metadata?.bookingId;
    return bookingId
      ? `/staff/bookings?bookingId=${encodeURIComponent(bookingId)}`
      : '/staff/bookings';
  }

  // Session
  if (type === 'PARKING' || eventType.includes('SESSION')) {
    const sessionId = notification?.metadata?.sessionId;
    if (sessionId) {
      return `/staff/sessions?sessionId=${encodeURIComponent(sessionId)}`;
    }
  }

  // Customer/Account
  if (type === 'ACCOUNT' || eventType.includes('CUSTOMER') || eventType.includes('USER')) {
    const userId = notification?.metadata?.userId || notification?.metadata?.customerId;
    if (userId) {
      return `/staff/accounts?userId=${encodeURIComponent(userId)}`;
    }
  }

  // Live Grid
  if (eventType.includes('FLOOR') || eventType.includes('OCCUPANCY')) {
    const floorId = notification?.metadata?.floorId;
    return floorId
      ? `/staff/live-grid?floorId=${encodeURIComponent(floorId)}`
      : '/staff/live-grid';
  }

  // Tickets
  if (eventType.includes('PACKAGE') || eventType.includes('TICKET')) {
    const packageId = notification?.metadata?.packageId;
    return packageId
      ? `/staff/tickets?packageId=${encodeURIComponent(packageId)}`
      : '/staff/tickets';
  }

  // Subscriptions
  if (eventType.includes('SUBSCRIPTION')) {
    const subscriptionId = notification?.metadata?.subscriptionId;
    const memberId = notification?.metadata?.memberId;
    if (subscriptionId) {
      return `/staff/subscriptions?subscriptionId=${encodeURIComponent(subscriptionId)}`;
    }
    if (memberId) {
      return `/staff/subscriptions?memberId=${encodeURIComponent(memberId)}`;
    }
    return '/staff/subscriptions';
  }

  // General notifications
  if (eventType === 'GENERAL' || type === 'SYSTEM' || eventType.includes('ALERT')) {
    return '/staff/notifications';
  }

  // Fallback to inbox if nothing matches
  return '/staff/notification-inbox';
};
