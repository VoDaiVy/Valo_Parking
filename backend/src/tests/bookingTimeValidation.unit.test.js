const test = require('node:test');
const assert = require('node:assert/strict');
const { validateBookingTimeRange } = require('../utils/bookingTimeValidation');

const now = new Date('2026-09-23T08:00:00.000Z');

test('booking time validation accepts a future range from 30 minutes through multiple days', () => {
  const minimum = validateBookingTimeRange(
    '2026-09-23T09:00:00.000Z',
    '2026-09-23T09:30:00.000Z',
    { now },
  );
  assert.equal(minimum.durationMinutes, 30);

  const multiDay = validateBookingTimeRange(
    '2026-10-03T00:00:00.000Z',
    '2026-10-09T01:00:00.000Z',
    { now },
  );
  assert.equal(multiDay.durationMinutes, 145 * 60);
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

test('booking time validation rejects malformed, reversed and short ranges', () => {
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
});
