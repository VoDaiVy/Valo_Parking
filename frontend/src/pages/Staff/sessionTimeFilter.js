// Compare calendar values in Vietnam, independent of the browser timezone.
export function matchesSessionTime(checkInTime, { mode = 'all', value = '', from = '', to = '' } = {}) {
  if (mode === 'all') return true;
  if (mode !== 'range' && !value) return true;
  if (mode === 'range' && !from && !to) return true;
  if (!checkInTime) return false;

  const timestamp = new Date(checkInTime).getTime();
  if (!Number.isFinite(timestamp)) return false;

  const vietnam = new Date(timestamp + 7 * 3600000).toISOString();
  if (mode === 'range') {
    if (from && to && from > to) return false;
    const minute = vietnam.slice(0, 16);
    return (!from || minute >= from) && (!to || minute <= to);
  }

  const length = { day: 10, month: 7, year: 4 }[mode];
  return Boolean(length && value.length === length && vietnam.slice(0, length) === value);
}
