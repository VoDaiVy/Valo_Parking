const Booking = require('../models/Booking');
const Link = require('../models/TelegramLink');
const { enqueueBookingTicket } = require('./telegramDeliveryService');
let cursor = null;

// Explicit rollout lower bound prevents accidentally messaging historical bookings.
// A rolling one-day window repairs hooks interrupted by a restart without an unbounded scan.
async function reconcileTelegramBookings(now = new Date()) {
  const rollout = new Date(process.env.TELEGRAM_EVENTS_FROM || 'invalid');
  if (!Number.isFinite(rollout.getTime())) return 0;
  const lower = new Date(Math.max(rollout.getTime(), now.getTime() - 86400000));
  const filter = { status: { $in: ['PAID', 'ACTIVE', 'PAUSED'] }, paidAt: { $gte: lower, $lte: now } };
  if (cursor) filter.$or = [{ paidAt: { $gt: cursor.paidAt } }, { paidAt: cursor.paidAt, _id: { $gt: cursor._id } }];
  const bookings = await Booking.find(filter).sort({ paidAt: 1, _id: 1 }).limit(100).lean();
  let count = 0;
  for (const booking of bookings) {
    const link = await Link.findOne({ userId: booking.userId, revokedAt: null, blockedAt: null, notificationsEnabled: true }).lean();
    if (!link || new Date(link.linkedAt) > new Date(booking.paidAt)) continue;
    await enqueueBookingTicket(booking); count++;
  }
  // Restart safely rescans the bounded day; dedupe keys prevent duplicate enqueue.
  cursor = bookings.length === 100 ? { paidAt: bookings[99].paidAt, _id: bookings[99]._id } : null;
  return count;
}
module.exports = { reconcileTelegramBookings };
