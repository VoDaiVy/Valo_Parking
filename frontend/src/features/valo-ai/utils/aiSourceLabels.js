export const sourceLabels = {
  check_system_health: 'System health', get_active_sessions: 'Active parking sessions', search_sessions: 'Session history', get_session_detail: 'Session details',
  search_users: 'User accounts', get_user_detail: 'User details', search_notification_recipients: 'Notification recipients', search_vehicles: 'Vehicles',
  search_bookings: 'Bookings', get_booking_detail: 'Booking details', get_parking_floors: 'Parking floors', get_parking_slots: 'Parking spaces',
  search_transactions: 'Transactions', get_subscription_members: 'Memberships', get_revenue_metrics: 'Revenue', get_session_statistics: 'Session statistics',
  get_parking_occupancy: 'Parking occupancy', get_user_summary: 'Account statistics', get_pricing_config: 'Pricing', get_package_list: 'Ticket packages',
  get_subscription_stats: 'Membership statistics', get_service_catalog: 'Services', get_policy_summary: 'Parking policies', get_ai_notifications: 'AI notifications'
};
export const sourceLabel = entry => sourceLabels[entry.tool] || sourceLabels[entry.source] || 'Other data source';
export const sourceUpdatedAt = value => {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return null;
  return `Updated at ${new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', dateStyle: 'medium', timeStyle: 'short' }).format(date)}`;
};
