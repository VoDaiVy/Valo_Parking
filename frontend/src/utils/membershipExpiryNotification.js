const EXPIRING_EVENTS = new Set([
  'MEMBERSHIP_ENTITLEMENT_EXPIRING_SOON', 'VIP_EXPIRING_SOON', 'SUBSCRIPTION_EXPIRING_SOON',
]);
const RENEWED_EVENTS = new Set(['MEMBERSHIP_ENTITLEMENT_RENEWAL_SUCCESS', 'SUBSCRIPTION_RENEWAL_SUCCESS']);
const text = (value) => typeof value === 'string' ? value.trim() : '';

function expiryDate(metadata) {
  for (const value of [metadata.expireAt, metadata.expiryCycle, metadata.expireDate]) {
    // Explicit timezone only: historical prose without an offset must not be
    // interpreted in the browser's local timezone or displayed verbatim.
    if (typeof value !== 'string' || !/(?:Z|[+-]\d{2}:?\d{2}|GMT[+-]\d{1,2})(?:\s|$|\))/.test(value)) continue;
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date;
  }
  return null;
}

export function membershipExpiryNotification(notification) {
  const metadata = notification?.metadata || {};
  const eventType = text(metadata.eventType).toUpperCase();
  const renewed = RENEWED_EVENTS.has(eventType);
  if (!renewed && !EXPIRING_EVENTS.has(eventType)) return null;
  const pkg = text(metadata.packageName) || 'Membership';
  const location = [text(metadata.slotCode), text(metadata.floorName)].filter(Boolean).join(', ');
  const identity = [pkg, location].filter(Boolean).join(' \u00b7 ');
  const expiry = expiryDate(renewed ? { ...metadata, expireAt: metadata.newExpireAt ?? metadata.expireAt } : metadata);
  const options = { timeZone: 'Asia/Ho_Chi_Minh', day: 'numeric', month: 'short', year: 'numeric' };
  const date = expiry ? new Intl.DateTimeFormat('en-GB', options).format(expiry) : null;
  const dateTime = expiry ? new Intl.DateTimeFormat('en-GB', { ...options, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(expiry) : null;
  if (renewed) return {
    title: 'Membership renewed successfully',
    summary: `${identity}\n${date ? `Valid until ${date}.` : 'View membership for your updated expiry.'}`,
    content: `Your membership has been renewed.\n${identity}\n${dateTime ? `Valid until ${dateTime}.` : 'View your membership for the updated expiry date.'}`,
  };
  return {
    title: 'Membership expiring soon',
    summary: `${identity}\n${date ? `Expires ${date} \u00b7 Renew now to keep your space.` : 'View membership for expiry and renewal details.'}`,
    content: `${identity}\n${dateTime ? `Expires ${dateTime}.` : 'Expiry date unavailable. View your membership for details.'}\nReview renewal eligibility in Membership and renew to keep your space.`,
  };
}
