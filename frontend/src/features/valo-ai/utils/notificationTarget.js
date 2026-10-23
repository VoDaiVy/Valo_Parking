const ADMIN_NOTIFICATION_ROUTES = new Set([
  '/admin/parking-lots', '/admin/bookings', '/admin/revenue', '/admin/sessions', '/admin/subscriptions',
]);

export const notificationTarget = (route) => {
  if (typeof route !== 'string' || /[\\#\s]/.test(route) || [...route].some((char) => char.charCodeAt(0) < 32)) return null;
  const basePath = route.split('?')[0];
  if (basePath === '/admin/sessions') {
    const params = new URLSearchParams(route.split('?').slice(1).join('?'));
    if (params.getAll('sessionId').length !== 1 || !/^[a-f\d]{24}$/i.test(params.get('sessionId'))) return null;
  }
  return ADMIN_NOTIFICATION_ROUTES.has(basePath) ? route : null;
};

export const notificationClickTarget = (item, role) => {
  let route = item.targetRoute;
  if (item.notificationType === 'NEW_SUBSCRIPTION' && role === 'admin') {
    if (route && !notificationTarget(route)) return null;
    if (route && route.split('?')[0] !== '/admin/subscriptions') return null;
    const id = [item.entityId, item.evidence?.subscriptionId].find((value) => typeof value === 'string' && /^[a-f\d]{24}$/i.test(value));
    if (!id) return null;
    return `/admin/subscriptions?subscriptionId=${id}`;
  }
  if (typeof route === 'string' && route.split('?')[0] === '/admin/subscriptions') return null;
  if (route === '/admin/bookings' && item.entityType === 'booking' && item.entityId) {
    route = `/admin/parking-lots?bookingId=${item.entityId}`;
  }
  const target = notificationTarget(route);
  if (target?.split('?')[0] === '/admin/sessions') {
    // This phase enables only Admin NEW_SESSION; other events keep opening detail.
    if (role !== 'admin' || item.notificationType !== 'NEW_SESSION') return null;
    const sessionId = new URLSearchParams(target.split('?')[1]).get('sessionId');
    if (item.entityId && String(item.entityId).toLowerCase() !== sessionId.toLowerCase()) return null;
  }
  return target && role === 'staff' ? target.replace(/^\/admin\//, '/staff/') : target;
};
