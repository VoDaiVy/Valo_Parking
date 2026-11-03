const Link = require('../models/TelegramLink');
const Claim = require('../models/TelegramClaimToken');
const Booking = require('../models/Booking');
const mongoose = require('mongoose');
const { createToken } = require('./telegramClaimService');
const profileService = require('./telegramProfileService');
const client = require('./telegramClient');
const { normalizePhone } = require('../utils/phoneUtils');
async function getStatus(userId) {
  const link = await Link.findOne({ userId, revokedAt: null }).select('+phone').lean();
  const phone = await profileService.profilePhone(userId);
  const needsPhone = !profileService.validPhone(phone);
  const phoneMatches = Boolean(link && !needsPhone && normalizePhone(link.phone) === phone);
  const available = client.enabled() && /^[A-Za-z0-9_]{5,32}$/.test(process.env.TELEGRAM_BOT_USERNAME || '');
  return { linked: phoneMatches, notificationsEnabled: phoneMatches && link.notificationsEnabled,
    ...(link ? { username: link.username || null, linkedAt: link.linkedAt, blocked: Boolean(link.blockedAt) } : {}),
    available, needsPhone, phoneMatches };
}
async function createLinkToken(userId, bookingId) {
  if (bookingId != null) {
    if (typeof bookingId !== 'string' || !mongoose.isValidObjectId(bookingId)) throw Object.assign(new Error('Mã booking không hợp lệ'), { statusCode: 400, code: 'INVALID_BOOKING' });
    if (!await Booking.exists({ _id: bookingId, userId, status: { $in: ['PAID', 'ACTIVE', 'PAUSED'] } })) throw Object.assign(new Error('Không tìm thấy booking hợp lệ của bạn'), { statusCode: 404, code: 'BOOKING_UNAVAILABLE' });
  }
  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      const profile = await profileService.lockProfile(userId, session);
      if (bookingId) {
        const existing = await require('../models/TelegramDelivery').findOne({ bookingId, kind: 'booking_paid',
          status: { $in: ['pending', 'processing', 'sent', 'uncertain'] } }).session(session);
        if (existing) {
          result = { state: existing.status, ...(existing.sentAt ? { sentAt: existing.sentAt } : {}) };
          return;
        }
      }
      const phone = normalizePhone(profile?.phone);
      if (!profileService.validPhone(phone)) throw Object.assign(new Error('Vui lòng lưu số điện thoại hợp lệ trong Hồ sơ trước khi bật Telegram.'), { statusCode: 400, code: 'PROFILE_PHONE_REQUIRED' });
      await Claim.updateMany({ userId, purpose: 'link', consumedAt: null }, { $set: { revokedAt: new Date() } }, { session });
      result = await createToken({ purpose: 'link', userId, recipientPhone: phone, ...(bookingId ? { bookingId } : {}) }, { session });
    });
  } finally { await session.endSession(); }
  return result;
}
async function unlink(userId) {
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      await profileService.lockProfile(userId, session);
      await profileService.revokeAccount(userId, session);
    });
  } finally { await session.endSession(); }
}
async function preferences(userId, notificationsEnabled) {
  if (notificationsEnabled) {
    const status = await getStatus(userId);
    if (!status.phoneMatches || status.blocked) throw Object.assign(new Error('Vui lòng xác minh lại Telegram với số điện thoại trong Hồ sơ.'), { statusCode: 409, code: 'TELEGRAM_RELINK_REQUIRED' });
  }
  await Link.updateOne({ userId, revokedAt: null }, { $set: { notificationsEnabled } });
  return getStatus(userId);
}
module.exports = { getStatus, createLinkToken, unlink, preferences };
