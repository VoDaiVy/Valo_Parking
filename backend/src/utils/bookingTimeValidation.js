const MIN_BOOKING_MINUTES = 30;
const VIP_SUGGESTION_DAYS = 7;
const MAX_BOOKING_DAYS = 90;
const MAX_BOOKING_MINUTES = MAX_BOOKING_DAYS * 24 * 60;

const bookingTimeError = (message, code) => Object.assign(new Error(message), {
  statusCode: 400,
  code,
});

function validateBookingTimeRange(startTime, endTime, {
  now = new Date(),
  requireFuture = true,
  minMinutes = MIN_BOOKING_MINUTES,
  maxMinutes = MAX_BOOKING_MINUTES,
} = {}) {
  const start = new Date(startTime);
  const end = new Date(endTime);
  const reference = now instanceof Date ? now : new Date(now);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || Number.isNaN(reference.getTime())) {
    throw bookingTimeError('Thời gian đặt chỗ không hợp lệ.', 'INVALID_BOOKING_TIME');
  }
  if (start >= end) {
    throw bookingTimeError('Giờ kết thúc phải sau giờ bắt đầu.', 'INVALID_BOOKING_RANGE');
  }
  if (requireFuture && start <= reference) {
    throw bookingTimeError('Ngày hoặc giờ bắt đầu đã qua. Vui lòng chọn thời gian trong tương lai.', 'PAST_BOOKING_TIME');
  }

  const durationMinutes = (end.getTime() - start.getTime()) / 60000;
  if (Number.isFinite(minMinutes) && durationMinutes < minMinutes) {
    throw bookingTimeError(`Thời gian đặt chỗ phải tối thiểu ${minMinutes} phút.`, 'BOOKING_DURATION_TOO_SHORT');
  }
  if (Number.isFinite(maxMinutes) && durationMinutes > maxMinutes) {
    throw bookingTimeError(
      `Thời gian đặt chỗ tối đa là ${MAX_BOOKING_DAYS} ngày.`,
      'BOOKING_DURATION_EXCEEDS_LIMIT',
    );
  }
  const suggestVip = durationMinutes > VIP_SUGGESTION_DAYS * 24 * 60;
  return { start, end, durationMinutes, suggestVip };
}

module.exports = {
  MIN_BOOKING_MINUTES,
  VIP_SUGGESTION_DAYS,
  MAX_BOOKING_DAYS,
  MAX_BOOKING_MINUTES,
  validateBookingTimeRange,
};
