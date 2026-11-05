const BOOKING_TIME_STEP_MINUTES = 15;

const roundUpToBookingStep = (value, { strictlyFuture = false } = {}) => {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const stepMs = BOOKING_TIME_STEP_MINUTES * 60 * 1000;
  const offset = strictlyFuture ? 1 : 0;
  return new Date(Math.ceil((date.getTime() + offset) / stepMs) * stepMs);
};

const isBookingStepAligned = (value) => {
  const date = value instanceof Date ? value : new Date(value);
  return !Number.isNaN(date.getTime())
    && date.getMinutes() % BOOKING_TIME_STEP_MINUTES === 0
    && date.getSeconds() === 0
    && date.getMilliseconds() === 0;
};

module.exports = {
  BOOKING_TIME_STEP_MINUTES,
  isBookingStepAligned,
  roundUpToBookingStep,
};
