const { BOOKING_TIME_STEP_MINUTES } = require('../utils/bookingTimePolicy');

const validateBookingInput = (prompt, today) => {
  const text = String(prompt || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd')
    .replace(/\b(\d{1,2})\s*-\s*(\d{1,2})\s*(h|gio)\b/g, '$1h den $2h');
  const invalid = (kind, value) => ({
    value,
    message: kind === 'date'
      ? `Ngày ${value} không tồn tại. Vui lòng nhập đúng ngày/tháng/năm, ví dụ 20/11/2026.`
      : `Giờ ${value} không hợp lệ. Vui lòng nhập giờ từ 00:00 đến 23:59, ví dụ 08:00 hoặc 20h30.`,
    englishMessage: kind === 'date'
      ? `Date ${value} does not exist. Please enter a valid day/month/year, for example 20/11/2026.`
      : `Time ${value} is invalid. Please enter a time from 00:00 to 23:59, for example 08:00 or 20h30.`,
  });
  const datePattern = /\b(\d{4})-(\d{1,2})-(\d{1,2})\b|\b(\d{1,2})[/.\-](\d{1,2})(?:[/.\-](\d{2,4}))?\b|\bngay\s+(\d{1,2})\s+thang\s+(\d{1,2})(?:\s+nam\s+(\d{4}))?\b/g;
  for (const match of text.matchAll(datePattern)) {
    const yearText = match[1] || match[6] || match[9] || String(today || '').slice(0, 4);
    const year = Number(yearText.length === 2 ? `20${yearText}` : yearText);
    const month = Number(match[2] || match[5] || match[8]);
    const day = Number(match[3] || match[4] || match[7]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) return invalid('date', match[0]);
    if (match[4] && /[.\-]/.test(match[0])) return {
      message: `Vui lòng nhập ngày ${match[0]} theo định dạng ngày/tháng/năm, ví dụ 20/11/2026.`,
      englishMessage: `Please enter ${match[0]} in day/month/year format, for example 20/11/2026.`,
    };
  }
  const withoutDates = text.replace(datePattern, ' ');
  for (const match of withoutDates.matchAll(/\bngay\s+(\d+)\b/g)) {
    if (Number(match[1]) < 1 || Number(match[1]) > 31) return invalid('date', match[0]);
  }
  const seconds = withoutDates.match(/\b\d{1,3}:\d{1,3}:\d+\b/);
  if (seconds) return invalid('time', seconds[0]);
  for (const match of withoutDates.matchAll(/\b(\d{1,3})\s*(?::|h|gio)\s*(\d{1,3})?(?:\s*phut)?(?:\s*(am|pm))?(?![a-z0-9])/g)) {
    const hour = Number(match[1]);
    const minute = Number(match[2] || 0);
    if (minute > 59) return invalid('time', match[0]);
    if (/\b(?:do|trong|sau|for)\s*$/.test(withoutDates.slice(0, match.index)) && !match[0].includes(':')) continue;
    if (hour > (match[3] ? 12 : 23) || (match[3] && hour < 1) || minute > 59) return invalid('time', match[0]);
    if (minute % BOOKING_TIME_STEP_MINUTES !== 0) return {
      message: `Giờ ${match[0].trim()} chưa đúng bước đặt chỗ ${BOOKING_TIME_STEP_MINUTES} phút. Vui lòng nhập lại giờ phù hợp; hệ thống không tự đổi giờ bạn chọn.`,
      englishMessage: `Time ${match[0].trim()} must use ${BOOKING_TIME_STEP_MINUTES}-minute booking intervals. Please enter a suitable time; your time will not be changed automatically.`,
    };
  }
  for (const match of withoutDates.matchAll(/\b(\d{1,3})(?::(\d{1,3}))?\s*(am|pm)\b/g)) {
    if (Number(match[1]) < 1 || Number(match[1]) > 12 || Number(match[2] || 0) > 59) return invalid('time', match[0]);
  }
  return null;
};
module.exports = { validateBookingInput };
