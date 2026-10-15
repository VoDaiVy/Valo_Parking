const { normalizeLicensePlate } = require('./licensePlateUtils');

const ACTIVE_BOOKING_STATUSES = Object.freeze(['PAID', 'ACTIVE', 'PAUSED']);

const buildVehicleBookingOverlapQuery = ({ vehicleId, licensePlate, start, end }) => {
  const normalizedPlate = normalizeLicensePlate(licensePlate);
  const vehicleMatches = [];
  if (vehicleId) vehicleMatches.push({ vehicleId });
  if (normalizedPlate) vehicleMatches.push({ licensePlate: normalizedPlate });
  if (!vehicleMatches.length) throw new Error('Vehicle ID or license plate is required');

  return {
    ...(vehicleMatches.length === 1 ? vehicleMatches[0] : { $or: vehicleMatches }),
    status: { $in: ACTIVE_BOOKING_STATUSES },
    scheduledStart: { $lt: end },
    scheduledEnd: { $gt: start },
  };
};

module.exports = { ACTIVE_BOOKING_STATUSES, buildVehicleBookingOverlapQuery };
