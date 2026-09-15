const ADMIN_NOTIFICATION_ROUTES = new Set([
  '/admin/parking-lots', '/admin/bookings', '/admin/revenue',
]);

export const notificationTarget = (route) => ADMIN_NOTIFICATION_ROUTES.has(route) ? route : null;
