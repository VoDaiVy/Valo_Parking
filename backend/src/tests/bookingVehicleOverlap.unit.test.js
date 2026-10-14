const assert = require('node:assert/strict');
const test = require('node:test');
const { buildVehicleBookingOverlapQuery } = require('../utils/bookingVehicleOverlap');

test('a registered vehicle matches both its ID and older plate-only bookings', () => {
  const start = new Date('2099-01-15T01:00:00Z');
  const end = new Date('2099-01-15T03:00:00Z');
  const query = buildVehicleBookingOverlapQuery({
    vehicleId: 'vehicle-1', licensePlate: '43A-123.45', start, end,
  });

  assert.deepEqual(query.$or, [
    { vehicleId: 'vehicle-1' },
    { licensePlate: '43A12345' },
  ]);
  assert.deepEqual(query.status.$in, ['PAID', 'ACTIVE', 'PAUSED']);
  assert.equal(query.scheduledStart.$lt, end);
  assert.equal(query.scheduledEnd.$gt, start);
});

test('a manual vehicle matches its normalized plate without an account-wide restriction', () => {
  const query = buildVehicleBookingOverlapQuery({
    licensePlate: '43B-543.21',
    start: new Date('2099-01-15T01:00:00Z'),
    end: new Date('2099-01-15T03:00:00Z'),
  });

  assert.equal(query.licensePlate, '43B54321');
  assert.equal(query.$or, undefined);
  assert.equal(query.userId, undefined);
});

test('a vehicle identifier is required before checking for overlap', () => {
  assert.throws(() => buildVehicleBookingOverlapQuery({ start: new Date(), end: new Date() }), /Vehicle ID or license plate/);
});
