require('dotenv').config();
const mongoose = require('mongoose');
const Booking = require('../models/Booking');
const Session = require('../models/Session');
const Pass = require('../models/ParkingPass');
const { normalizeLicensePlate } = require('../utils/licensePlateUtils');

async function auditParkingPasses() {
  const active = await Session.find({ status: 'active' }).select('licensePlate floorId parkingSlot bookingId').lean();
  const plates = new Map();
  const slots = new Map();
  let normalizedPlateCount = 0;
  for (const item of active) {
    const plate = normalizeLicensePlate(item.licensePlate);
    if (plate !== item.licensePlate) normalizedPlateCount += 1;
    if (plate) plates.set(plate, (plates.get(plate) || 0) + 1);
    if (item.floorId && item.parkingSlot) {
      const slot = `${item.floorId}:${String(item.parkingSlot).trim().toUpperCase()}`;
      slots.set(slot, (slots.get(slot) || 0) + 1);
    }
  }
  const duplicateGroups = (map) => [...map.values()].filter((count) => count > 1).length;
  const bookings = await Booking.find({ status: { $in: ['PAID', 'ACTIVE', 'PAUSED'] } }).select('_id').lean();
  const existing = await Pass.find({ $or: [
    { bookingId: { $in: bookings.map((item) => item._id) } },
    { originSessionId: { $in: active.filter((item) => !item.bookingId).map((item) => item._id) } },
  ] }).select('bookingId originSessionId').lean();
  const existingBookings = new Set(existing.filter((item) => item.bookingId).map((item) => String(item.bookingId)));
  const existingSessions = new Set(existing.filter((item) => item.originSessionId).map((item) => String(item.originSessionId)));
  return {
    activeSessions: active.length,
    activeDuplicatePlateGroups: duplicateGroups(plates),
    activeDuplicateSlotGroups: duplicateGroups(slots),
    activeUnnormalizedPlates: normalizedPlateCount,
    eligibleBookings: bookings.length,
    missingBookingPasses: bookings.filter((item) => !existingBookings.has(String(item._id))).length,
    missingSessionPasses: active.filter((item) => !item.bookingId && !existingSessions.has(String(item._id))).length,
  };
}

async function main() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required.');
  await mongoose.connect(process.env.MONGODB_URI);
  try {
    const result = await auditParkingPasses();
    console.log(JSON.stringify(result, null, 2));
    if (result.activeDuplicatePlateGroups || result.activeDuplicateSlotGroups || result.activeUnnormalizedPlates) process.exitCode = 2;
  } finally { await mongoose.disconnect(); }
}

if (require.main === module) main().catch(() => { console.error('Parking pass audit failed; verify database connectivity and permissions.'); process.exitCode = 1; });
module.exports = { auditParkingPasses };
