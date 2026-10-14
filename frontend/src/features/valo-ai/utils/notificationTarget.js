const ADMIN_NOTIFICATION_ROUTES = new Set([
  '/admin/parking-lots', '/admin/bookings', '/admin/revenue',
]);

export const notificationTarget = (route) => {
  if (!route) return null;
  const basePath = route.split('?')[0];
  return ADMIN_NOTIFICATION_ROUTES.has(basePath) ? route : null;
};
