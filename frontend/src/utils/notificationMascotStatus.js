// Business type (BOOKING/SYSTEM/...) is separate from presentation status.
// These keys come from notificationService templates/notificationTriggers.
const EVENTS = Object.freeze({
  SUCCESS: new Set([
    'REGISTRATION_SUCCESS', 'EMAIL_VERIFIED', 'ACCOUNT_UNLOCKED',
    'TOPUP_SUCCESS', 'REFUND_SUCCESS', 'PAYMENT_SUCCESS', 'BOOKING_SUCCESS',
    'VIOLATION_PAID', 'TRANSFER_APPROVED', 'TRANSFER_COMPLETED',
    'MEMBERSHIP_TRANSFER_COMPLETED', 'CONTRACT_ACTIVATED',
    'VEHICLE_ENTRY', 'VEHICLE_EXIT', 'PLATE_RECOGNIZED', 'LOYALTY_POINTS_EARNED',
    'SUBSCRIPTION_RENEWED', 'SUBSCRIPTION_RENEWAL_SUCCESS',
    'MEMBERSHIP_ENTITLEMENT_RENEWED', 'MEMBERSHIP_ENTITLEMENT_RENEWAL_SUCCESS',
  ]),
  WARNING: new Set([
    'PASSWORD_CHANGED', 'ACCOUNT_LOCKED', 'LOW_BALANCE', 'VIOLATION_CREATED',
    'VIOLATION_PAYMENT_REMINDER', 'BOOKING_CANCELLED', 'BOOKING_CHECKIN_EXPIRED',
    'BOOKING_ENDING_SOON', 'BOOKING_TIME_EXPIRED', 'BOOKING_NO_SHOW_CANCELLED',
    'VIP_EXPIRING_SOON', 'VIP_EXPIRED', 'TRANSFER_REJECTED', 'CONTRACT_CANCELLED',
    'CONTRACT_EXPIRED', 'PARKING_30MIN_WARNING', 'PARKING_15MIN_WARNING',
    'PARKING_5MIN_WARNING', 'PARKING_EXPIRED', 'PARKING_OVERTIME',
    'PARKING_OVERTIME_REPEAT', 'PLATE_NOT_RECOGNIZED', 'PLATE_MISMATCH',
    'SUBSCRIPTION_EXPIRING_SOON', 'SUBSCRIPTION_EXPIRED',
    'MEMBERSHIP_ENTITLEMENT_EXPIRING_SOON', 'MEMBERSHIP_ENTITLEMENT_EXPIRED',
    'SUBSCRIPTION_RENEWAL_NOT_ELIGIBLE', 'SUBSCRIPTION_RENEWAL_WINDOW_NOT_OPEN',
    'MEMBERSHIP_ENTITLEMENT_RENEWAL_NOT_ELIGIBLE',
  ]),
  ERROR: new Set([
    // Only confirmed failed operations, never expiry or renewal eligibility.
    'TOPUP_FAILED', 'PAYMENT_FAILED', 'SUBSCRIPTION_RENEWAL_FAILED',
    'MEMBERSHIP_ENTITLEMENT_RENEWAL_FAILED',
  ]),
  SYSTEM: new Set(['SYSTEM_MAINTENANCE', 'SYSTEM_UPDATE']),
  INFO: new Set([
    'VIOLATION_CANCELLED', 'TRANSFER_REQUEST_CREATED',
    'MEMBERSHIP_TRANSFER_LISTED', 'MEMBERSHIP_TRANSFER_CLAIMED',
  ]),
});

export const NOTIFICATION_STATUSES = Object.freeze(['INFO', 'SUCCESS', 'WARNING', 'ERROR', 'SYSTEM']);

// The schema calls this field "priority", but it is a five-value presentation
// enum, not urgency (HIGH/URGENT) or delivery status (SENT/FAILED).
export function normalizeNotificationStatus(value) {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

export function resolveNotificationMascotStatus(notification) {
  // Authoritative field from the compose form, schema, REST projection and
  // socket payload. Explicit INFO/SYSTEM are as intentional as explicit ERROR.
  const priority = normalizeNotificationStatus(notification?.priority);
  if (NOTIFICATION_STATUSES.includes(priority)) return priority;

  // Legacy event-only records: use an exact business-event table, never type,
  // createdBy, channels, delivery status, or title/content keyword guesses.
  const eventType = normalizeNotificationStatus(notification?.metadata?.eventType);
  for (const [status, events] of Object.entries(EVENTS)) {
    if (events.has(eventType)) return status;
  }
  // Reminder producers include the milestone in their event key.
  if (/^BOOKING_(CHECKIN_REMINDER|ENDING)_\d+$/.test(eventType)) return 'WARNING';
  return 'INFO';
}

export const NOTIFICATION_MASCOTS = Object.freeze({
  SUCCESS: { label: 'Success', image: 'success', accent: 'text-emerald-700', badge: 'bg-emerald-100', button: 'bg-emerald-600 hover:bg-emerald-700' },
  INFO: { label: 'Information', image: 'info', accent: 'text-blue-700', badge: 'bg-blue-100', button: 'bg-blue-600 hover:bg-blue-700' },
  WARNING: { label: 'Warning', image: 'warning', accent: 'text-amber-800', badge: 'bg-amber-100', button: 'bg-amber-600 hover:bg-amber-700' },
  ERROR: { label: 'Error', image: 'error', accent: 'text-red-700', badge: 'bg-red-100', button: 'bg-red-600 hover:bg-red-700' },
  SYSTEM: { label: 'System', image: 'system', accent: 'text-purple-700', badge: 'bg-purple-100', button: 'bg-purple-600 hover:bg-purple-700' },
});
