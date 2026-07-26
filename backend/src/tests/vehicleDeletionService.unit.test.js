const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ACTIVE_SESSION_BLOCKER,
  ACTIVE_BOOKING_BLOCKER,
  buildBlockingBookingQuery,
  findVehicleDeletionBlocker,
} = require('../services/vehicleDeletionService');

const vehicle = {
  _id: 'vehicle-id',
  licensePlate: '43B20408T',
};

const modelReturning = (result) => ({
  exists: async () => result,
});

test('blocks deletion while the vehicle has an active parking session', async () => {
  const blocker = await findVehicleDeletionBlocker({
    vehicle,
    SessionModel: modelReturning({ _id: 'session-id' }),
    BookingModel: modelReturning(null),
  });

  assert.deepEqual(blocker, ACTIVE_SESSION_BLOCKER);
});

test('blocks deletion for an active, paused, or upcoming paid booking', async () => {
  const blocker = await findVehicleDeletionBlocker({
    vehicle,
    SessionModel: modelReturning(null),
    BookingModel: modelReturning({ _id: 'booking-id' }),
  });

  assert.deepEqual(blocker, ACTIVE_BOOKING_BLOCKER);
});

test('allows deletion when neither an active session nor blocking booking exists', async () => {
  const blocker = await findVehicleDeletionBlocker({
    vehicle,
    SessionModel: modelReturning(null),
    BookingModel: modelReturning(null),
  });

  assert.equal(blocker, null);
});

test('matches bookings by vehicle id or license plate and only blocks relevant states', () => {
  const now = new Date('2026-07-26T04:00:00.000Z');

  assert.deepEqual(buildBlockingBookingQuery(vehicle, now), {
    $and: [
      {
        $or: [
          { vehicleId: vehicle._id },
          { licensePlate: vehicle.licensePlate },
        ],
      },
      {
        $or: [
          { status: { $in: ['ACTIVE', 'PAUSED'] } },
          {
            status: 'PAID',
            scheduledEnd: { $gt: now },
          },
        ],
      },
    ],
  });
});
