const Slot = require('../models/Slot');
const Booking = require('../models/Booking');
const BookingHold = require('../models/BookingHold');

const conflict = (message, code) => Object.assign(new Error(message), { statusCode: 409, code });

async function assertNoMembershipBookingConflict({ floorId, slotCode, validFrom, expireAt, session = null }) {
  slotCode = String(slotCode || '').trim().toUpperCase();
  const start = new Date(validFrom), end = new Date(expireAt);
  if (![start, end].every(date => Number.isFinite(date.getTime())) || end <= start) {
    throw conflict('The membership reservation period is invalid.', 'INVALID_RESERVATION_PERIOD');
  }
  if (session) {
    if (!session.inTransaction()) throw new Error('Membership conflict checks require an active transaction.');
    // Booking confirmation and hold creation write this same slot before reading
    // rights. A concurrent writer must retry and observe the winning reservation.
    const locked = await Slot.updateOne({ floorID: floorId, slotNumber: slotCode },
      { $inc: { __v: 1 } }, { session });
    if (!locked.matchedCount) throw conflict(`Slot ${slotCode} no longer exists.`, 'SLOT_NOT_FOUND');
  }
  const booking = await Booking.exists({ floorId, parkingSlot: slotCode,
    status: { $in: ['PAID', 'ACTIVE', 'PAUSED'] },
    scheduledStart: { $lt: end }, scheduledEnd: { $gt: start },
  }).session(session);
  if (booking) throw conflict(`Slot ${slotCode} has a confirmed booking overlapping this membership period. Choose another slot.`, 'MEMBERSHIP_BOOKING_CONFLICT');
  const hold = await BookingHold.exists({ floorId, slotCode, status: 'active',
    expiresAt: { $gt: new Date() }, startTime: { $lt: end }, endTime: { $gt: start },
  }).session(session);
  if (hold) throw conflict(`Slot ${slotCode} has an active hold overlapping this membership period. Choose another slot or retry after the hold expires.`, 'MEMBERSHIP_HOLD_CONFLICT');
}

module.exports = { assertNoMembershipBookingConflict };
