const ACTIVE_SESSION_BLOCKER = {
  code: 'VEHICLE_ACTIVE_SESSION',
  message:
    'This vehicle is currently checked in. Please check out before deleting it.',
};

const ACTIVE_BOOKING_BLOCKER = {
  code: 'VEHICLE_ACTIVE_BOOKING',
  message:
    'This vehicle has an active or upcoming paid booking. Change or finish the booking before deleting it.',
};

const buildBlockingBookingQuery = (vehicle, now = new Date()) => ({
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

const findVehicleDeletionBlocker = async ({
  vehicle,
  SessionModel,
  BookingModel,
  now = new Date(),
}) => {
  const [activeSession, blockingBooking] = await Promise.all([
    SessionModel.exists({
      licensePlate: vehicle.licensePlate,
      status: 'active',
    }),
    BookingModel.exists(buildBlockingBookingQuery(vehicle, now)),
  ]);

  if (activeSession) return ACTIVE_SESSION_BLOCKER;
  if (blockingBooking) return ACTIVE_BOOKING_BLOCKER;
  return null;
};

module.exports = {
  ACTIVE_SESSION_BLOCKER,
  ACTIVE_BOOKING_BLOCKER,
  buildBlockingBookingQuery,
  findVehicleDeletionBlocker,
};
