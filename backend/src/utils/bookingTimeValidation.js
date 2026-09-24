const MIN_BOOKING_MINUTES = 30;
const MAX_BOOKING_MINUTES = 24 * 60;

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
    throw bookingTimeError(`Thời gian đặt chỗ không được vượt quá ${Math.round(maxMinutes / 60)} giờ.`, 'BOOKING_DURATION_TOO_LONG');
  }

  return { start, end, durationMinutes };
}

module.exports = {
  MAX_BOOKING_MINUTES,
  MIN_BOOKING_MINUTES,
  validateBookingTimeRange,
};
