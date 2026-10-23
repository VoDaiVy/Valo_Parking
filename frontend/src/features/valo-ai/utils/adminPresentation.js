export const adminSuggestions = ['Check operational risks', 'Show today’s parking sessions', 'Summarize parking occupancy'];
export const adminFilters = [['all', 'All'], ['unread', 'Unread'], ['warning', 'Warning'], ['critical', 'Critical']];
const labels = { timeCost: 'Duration (minutes)', maxSlots: 'Maximum spaces', cap12h: '12-hour cap', cap24h: '24-hour cap', isActive: 'Active', slot: 'Parking space', floor: 'Parking floor', expectedDurationHours: 'Expected duration (hours)', robustDeviation: 'Statistical deviation' };
export const readableLabel = (key = '') => labels[key] || String(key).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]/g, ' ').replace(/^./, (letter) => letter.toUpperCase());
export const adminDate = (value, timeOnly = false) => {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return 'Not available';
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', ...(timeOnly ? { hour: '2-digit', minute: '2-digit' } : { dateStyle: 'medium', timeStyle: 'short' }) }).format(date);
};
export const adminValue = (value) => {
  if (value === null || value === undefined || value === '') return 'Not available';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return new Intl.NumberFormat('en-GB').format(value);
  if (Array.isArray(value)) return value.map(adminValue).join(' · ');
  if (typeof value === 'object') return Object.entries(value).map(([key, entry]) => `${readableLabel(key)}: ${adminValue(entry)}`).join('; ');
  return String(value);
};
const titles = {
  NEW_SESSION: 'New parking session', NEW_SUBSCRIPTION: 'New VIP subscription', NEW_BOOKING: 'New paid booking',
  BOOKING_CANCELLED: 'Booking cancelled', NEW_USER_REGISTERED: 'New customer registration',
  VEHICLE_PENDING_VERIFICATION: 'Vehicle awaiting verification', FLOOR_FULL: 'Parking floor full',
  FLOOR_AVAILABLE_AGAIN: 'Parking spaces available again', OCCUPANCY_HIGH: 'High parking occupancy',
  SESSION_OVERDUE: 'Parking session overdue', REFUND_COMPLETED: 'Refund completed',
  REVENUE_ANOMALY: 'Revenue variation detected', SESSION_CHANGE: 'Parking session variation detected',
};
export const adminNotification = (item) => {
  const e = item.evidence || {};
  const summaries = {
    NEW_SESSION: e.licensePlate ? `Vehicle ${e.licensePlate} started parking${e.slot ? ` at space ${e.slot}` : ''}.` : 'A new parking session has started.',
    NEW_SUBSCRIPTION: 'A VIP subscription was activated. Open the subscription to view package and ownership details.',
    NEW_BOOKING: 'A parking booking has been paid. Open the booking to view its details.',
    BOOKING_CANCELLED: 'A parking booking was cancelled. Open the booking to view its details.',
    NEW_USER_REGISTERED: e.username ? `${e.username} created a VALO account.` : 'A new customer account was created.',
    VEHICLE_PENDING_VERIFICATION: e.licensePlate ? `Vehicle ${e.licensePlate} requires Admin verification.` : 'A registered vehicle requires Admin verification.',
    FLOOR_FULL: 'No general booking spaces are currently available on this floor.',
    FLOOR_AVAILABLE_AGAIN: Number.isFinite(e.available) ? `${adminValue(e.available)} spaces are now available on this floor.` : 'Parking spaces are available again on this floor.',
    OCCUPANCY_HIGH: Number.isFinite(e.ratio) ? `Occupancy has reached ${Math.round(e.ratio * 100)}%.` : 'This floor is approaching capacity.',
    SESSION_OVERDUE: e.licensePlate ? `Vehicle ${e.licensePlate} has exceeded its expected parking duration.` : 'A parking session has exceeded its expected duration.',
    REFUND_COMPLETED: Number.isFinite(e.amount) ? `A refund of ${adminValue(e.amount)} VND was completed.` : 'A booking refund was completed.',
    REVENUE_ANOMALY: 'Revenue differs from comparable historical periods. The cause has not been established.',
    SESSION_CHANGE: 'Parking activity differs from comparable historical periods. The cause has not been established.',
  };
  return { ...item, title: titles[item.notificationType] || 'Operational notification', summary: summaries[item.notificationType] || 'Review the operational evidence for this notification.' };
};
export const adminActions = (type) => type === 'REVENUE_ANOMALY'
  ? ['Review revenue figures and pricing for the same period to investigate the variation.']
  : type === 'SESSION_CHANGE' ? ['Review session statistics and parking occupancy for the same period.'] : [];
export const adminSourceLabel = (entry) => readableLabel(String(entry.tool || entry.source || 'Operational data').replace(/^(get|search|check)_/, ''));
