const test = require('node:test');
const assert = require('node:assert/strict');
const { validateBookingTimeRange } = require('../utils/bookingTimeValidation');

const now = new Date('2026-09-23T08:00:00.000Z');

test('booking time validation accepts a future range from 30 minutes through 24 hours', () => {
  const minimum = validateBookingTimeRange(
    '2026-09-23T09:00:00.000Z',
    '2026-09-23T09:30:00.000Z',
    { now },
  );
  assert.equal(minimum.durationMinutes, 30);

  const maximum = validateBookingTimeRange(
    '2026-09-24T09:00:00.000Z',
    '2026-09-25T09:00:00.000Z',
    { now },
  );
  assert.equal(maximum.durationMinutes, 24 * 60);
});

test('booking time validation rejects past and current start instants', () => {
  for (const start of ['2026-09-22T09:00:00.000Z', '2026-09-23T08:00:00.000Z']) {
    assert.throws(
      () => validateBookingTimeRange(start, '2026-09-23T10:00:00.000Z', { now }),
      (error) => error.statusCode === 400 && error.code === 'PAST_BOOKING_TIME' && /đã qua/.test(error.message),
      start,
    );
  }
});

test('booking time validation rejects malformed, reversed, short and overlong ranges', () => {
  assert.throws(
    () => validateBookingTimeRange('not-a-date', '2026-09-23T10:00:00.000Z', { now }),
    (error) => error.code === 'INVALID_BOOKING_TIME',
  );
  assert.throws(
    () => validateBookingTimeRange('2026-09-23T10:00:00.000Z', '2026-09-23T09:00:00.000Z', { now }),
    (error) => error.code === 'INVALID_BOOKING_RANGE',
  );
  assert.throws(
    () => validateBookingTimeRange('2026-09-23T09:00:00.000Z', '2026-09-23T09:29:00.000Z', { now }),
    (error) => error.code === 'BOOKING_DURATION_TOO_SHORT',
  );
  assert.throws(
    () => validateBookingTimeRange('2026-09-24T09:00:00.000Z', '2026-09-25T09:01:00.000Z', { now }),
    (error) => error.code === 'BOOKING_DURATION_TOO_LONG',
  );
});
