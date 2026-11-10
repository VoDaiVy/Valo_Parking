const ADMIN_NOTIFICATION_ROUTES = new Set([
  '/admin/parking-lots', '/admin/bookings', '/admin/revenue', '/admin/sessions', '/admin/subscriptions',
  '/admin/vehicle-models', '/admin/accounts', '/admin/pricing',
]);

export const notificationTarget = (route) => {
  if (typeof route !== 'string' || /[\\#\s]/.test(route) || [...route].some((char) => char.charCodeAt(0) < 32)) return null;
  const basePath = route.split('?')[0];
  const query = new URLSearchParams(route.split('?')[1]);
  for (const key of ['sessionId', 'bookingId', 'subscriptionId', 'userId', 'floorId', 'slotId', 'vehicleId']) {
    if (query.has(key) && (query.getAll(key).length !== 1 || !/^[a-f\d]{24}$/i.test(query.get(key)))) return null;
  }
  if (basePath === '/admin/sessions') {
    const params = new URLSearchParams(route.split('?').slice(1).join('?'));
    if (params.getAll('sessionId').length !== 1 || !/^[a-f\d]{24}$/i.test(params.get('sessionId'))) return null;
  }
  return ADMIN_NOTIFICATION_ROUTES.has(basePath) ? route : null;
};

export const notificationClickTarget = (item, role) => {
  let route = item.targetRoute;
  if (role === 'admin') {
    const entity = String(item.entityType || '').toLowerCase();
    const id = String(item.entityId || '');
    const destinations = { session: ['/admin/sessions', 'sessionId'], booking: ['/admin/parking-lots', 'bookingId'], subscription: ['/admin/subscriptions', 'subscriptionId'], user: ['/admin/accounts', 'userId'], floor: ['/admin/parking-lots', 'floorId'] };
    if (destinations[entity]) {
      if (!/^[a-f\d]{24}$/i.test(id)) return null;
      const [path, key] = destinations[entity];
      if (route) {
        const old = notificationTarget(route === '/admin/sessions' ? `${route}?sessionId=${id}` : route);
        if (!old || (old.split('?')[0] !== path && !(entity === 'booking' && old.split('?')[0] === '/admin/bookings'))) return null;
        const params = new URLSearchParams(route.split('?')[1]);
        if (params.has(key) && params.get(key).toLowerCase() !== id.toLowerCase()) return null;
      }
      return `${path}?${key}=${id}`;
    }
  }
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
