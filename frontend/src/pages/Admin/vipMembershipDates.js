const vietnamDate = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: 'short', year: 'numeric',
});
const dayParts = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
});
const dayNumber = (date) => {
  const parts = Object.fromEntries(dayParts.formatToParts(date).map(({ type, value }) => [type, value]));
  return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)) / 86400000;
};
export const vipDate = (value) => {
  const date = value ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? vietnamDate.format(date) : 'Not available';
};
export const vipDaysUntil = (value, now = new Date()) => {
  const end = value ? new Date(value) : null;
  return end && Number.isFinite(end.getTime()) ? dayNumber(end) - dayNumber(now) : null;
};
