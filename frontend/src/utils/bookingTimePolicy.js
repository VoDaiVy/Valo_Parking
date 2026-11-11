export const BOOKING_TIME_STEP_MINUTES = 15;
export const MIN_BOOKING_DURATION_MINUTES = 30;

export function roundUpToBookingStep(value = new Date(), { strictlyFuture = false } = {}) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const stepMs = BOOKING_TIME_STEP_MINUTES * 60 * 1000;
  const offset = strictlyFuture ? 1 : 0;
  return new Date(Math.ceil((date.getTime() + offset) / stepMs) * stepMs);
}

export function alignBookingClockValue(value) {
  const match = String(value || '').match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!match) return { time: value, dayOffset: 0 };
  const total = Number(match[1]) * 60 + Number(match[2]);
  const rounded = Math.ceil(total / BOOKING_TIME_STEP_MINUTES) * BOOKING_TIME_STEP_MINUTES;
  const minuteOfDay = rounded % (24 * 60);
  return {
    time: `${String(Math.floor(minuteOfDay / 60)).padStart(2, '0')}:${String(minuteOfDay % 60).padStart(2, '0')}`,
    dayOffset: Math.floor(rounded / (24 * 60)),
  };
}

export function addBookingCalendarDays(value, count) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match || !Number.isInteger(count)) return value;
  const date = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}
