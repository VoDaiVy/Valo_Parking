export const membershipDate = (value) => value && !Number.isNaN(new Date(value).getTime())
  ? new Date(value).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Ho_Chi_Minh' }) : 'Unavailable';

export function membershipTiming(value, status = 'active', now = new Date()) {
  const end = new Date(value);
  if (!value || Number.isNaN(end.getTime())) return { status, daysRemaining: null, label: 'Expiration unavailable' };
  const effectiveStatus = ['active', 'transfer_locked'].includes(status) && end <= now ? 'expired' : status;
  if (effectiveStatus === 'expired') return { status: effectiveStatus, daysRemaining: 0, label: 'Expired' };
  const day = (date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  const daysRemaining = Math.max(0, Math.ceil((end - now) / 86400000));
  return { status: effectiveStatus, daysRemaining, label: ['active', 'transfer_locked'].includes(effectiveStatus) && end > now && day(end) === day(now) ? 'Expires today' : `${daysRemaining} days remaining` };
}

// Presentation only: renewal permission always comes from the backend.
export function membershipPresentation(entity, now = new Date()) {
  const timing = membershipTiming(entity.expireAt, entity.status, now);
  const remaining = new Date(entity.expireAt) - now;
  const windowDays = Number(entity.expiryReminderDays ?? entity.renewal?.renewalWindowDays);
  const expiring = Number.isFinite(windowDays) && windowDays > 0
    ? remaining > 0 && remaining <= windowDays * 86400000
    : entity.expiringSoon === true;
  const state = !entity.expireAt || !Number.isFinite(remaining) ? 'UNAVAILABLE' : timing.status === 'expired' ? 'EXPIRED'
    : timing.status !== 'active' ? String(timing.status || 'unavailable').toUpperCase()
      : timing.label === 'Expires today' ? 'EXPIRES_TODAY'
        : expiring ? 'EXPIRING_SOON' : 'ACTIVE';
  const labels = { ACTIVE: 'Active', EXPIRING_SOON: 'Expiring soon', EXPIRES_TODAY: 'Expires today', EXPIRED: 'Expired', TRANSFER_LOCKED: 'Transfer locked' };
  return { ...timing, state, statusLabel: labels[state] || 'Unavailable',
    canRenew: entity.renewal?.canRenew === true && timing.status === 'active' && remaining > 0,
    renewalMessage: timing.status === 'expired' && entity.renewal?.canRenew ? 'This membership has expired. Renewal is unavailable.' : entity.renewal?.message || (entity.renewal?.canRenew ? 'Eligible for renewal.' : 'Renewal unavailable.'),
  };
}

export function membershipFloorName(name, number) {
  return (typeof name === 'string' && name.trim() ? name : null) ?? number ?? 'Unavailable';
}
