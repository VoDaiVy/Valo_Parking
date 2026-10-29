const Link = require('../models/TelegramLink');
const Claim = require('../models/TelegramClaimToken');
const Delivery = require('../models/TelegramDelivery');
const Booking = require('../models/Booking');
const mongoose = require('mongoose');
const { createToken } = require('./telegramClaimService');
async function getStatus(userId) {
  const link = await Link.findOne({ userId, revokedAt: null }).lean();
  return link ? { linked: true, notificationsEnabled: link.notificationsEnabled, username: link.username || null, linkedAt: link.linkedAt, blocked: Boolean(link.blockedAt) } : { linked: false, notificationsEnabled: false };
}
async function createLinkToken(userId, bookingId) {
  if (bookingId != null) {
    if (typeof bookingId !== 'string' || !mongoose.isValidObjectId(bookingId)) throw Object.assign(new Error('Mã booking không hợp lệ'), { statusCode: 400, code: 'INVALID_BOOKING' });
    if (!await Booking.exists({ _id: bookingId, userId, status: { $in: ['PAID', 'ACTIVE', 'PAUSED'] } })) throw Object.assign(new Error('Không tìm thấy booking hợp lệ của bạn'), { statusCode: 404, code: 'BOOKING_UNAVAILABLE' });
  }
  await Claim.updateMany({ userId, purpose: 'link', consumedAt: null }, { $set: { revokedAt: new Date() } });
  return createToken({ purpose: 'link', userId, ...(bookingId ? { bookingId } : {}) });
}
async function unlink(userId) {
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const link = await Link.findOneAndUpdate({ userId }, { $set: { revokedAt: new Date(), notificationsEnabled: false } }, { session });
      await Claim.updateMany({ userId, purpose: 'link', consumedAt: null }, { $set: { revokedAt: new Date() } }, { session });
      if (link) await Delivery.updateMany({ linkId: link._id, status: { $in: ['pending', 'uncertain'] } }, { $set: { status: 'cancelled', errorCode: 'LINK_REVOKED' } }, { session });
    });
  } finally { await session.endSession(); }
}
async function preferences(userId, notificationsEnabled) {
  await Link.updateOne({ userId, revokedAt: null }, { $set: { notificationsEnabled } });
  return getStatus(userId);
}
module.exports = { getStatus, createLinkToken, unlink, preferences };
