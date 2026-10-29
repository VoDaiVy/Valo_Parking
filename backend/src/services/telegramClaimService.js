const crypto = require('crypto');
const mongoose = require('mongoose');
const Claim = require('../models/TelegramClaimToken');
const Link = require('../models/TelegramLink');
const Session = require('../models/Session');
const Delivery = require('../models/TelegramDelivery');
const { normalizePhone } = require('../utils/phoneUtils');
const client = require('./telegramClient');

const hashToken = token => crypto.createHash('sha256').update(token).digest('hex');
function validateOwnContact(message) {
  return message?.chat?.type === 'private' && message.contact &&
    String(message.contact.user_id) === String(message.from?.id) &&
    /^\+?[\d\s()-]{7,24}$/.test(message.contact.phone_number || '') &&
    /^\d{7,15}$/.test((message.contact.phone_number || '').replace(/\D/g, ''));
}
function configured() {
  const username = process.env.TELEGRAM_BOT_USERNAME;
  if (!client.enabled() || !/^[A-Za-z0-9_]{5,32}$/.test(username || '')) {
    throw Object.assign(new Error('Telegram chưa được bật'), { statusCode: 503, code: 'TELEGRAM_DISABLED' });
  }
  return username;
}
async function createToken(fields, { session } = {}) {
  const username = configured();
  const token = crypto.randomBytes(24).toString('base64url');
  const expiresAt = new Date(Date.now() + 10 * 60000);
  await Claim.create([{ ...fields, tokenHash: hashToken(token), expiresAt }], { session });
  return { deepLink: `https://t.me/${username}?start=${token}`, expiresAt };
}
async function createGuestClaim({ sessionId, passId }, options = {}) {
  if (!client.enabled()) return null;
  const record = await Session.findById(sessionId).session(options.session || null);
  if (!record || record.type !== 'WALK_IN' || record.status !== 'active' || !/^0\d{9}$/.test(normalizePhone(record.phone))) return null;
  const ticket = await require('./parkingPassService').getPassTicket(passId, options);
  if (String(ticket.session?._id) !== String(sessionId)) return null;
  return createToken({ purpose: 'guest', sessionId, passId, passVersion: ticket.pass.qrVersion }, options);
}
async function bindStart(message, token) {
  if (!/^[A-Za-z0-9_-]{32}$/.test(token)) return false;
  const now = new Date();
  const binding = { boundTelegramUserId: String(message.from.id), boundChatId: String(message.chat.id) };
  const claim = await Claim.findOneAndUpdate({ tokenHash: hashToken(token), consumedAt: null, revokedAt: null, expiresAt: { $gt: now },
    $or: [{ boundTelegramUserId: { $exists: false } }, binding] }, { $set: binding }, { new: true });
  return Boolean(claim);
}
async function consumeContact(message) {
  if (!validateOwnContact(message)) return { ok: false, text: 'Vui lòng dùng nút chia sẻ số điện thoại của chính bạn.' };
  const identity = { boundTelegramUserId: String(message.from.id), boundChatId: String(message.chat.id) };
  let outcome;
  const dbSession = await mongoose.startSession();
  try {
    await dbSession.withTransaction(async () => {
      const claim = await Claim.findOne({ ...identity, consumedAt: null, revokedAt: null, expiresAt: { $gt: new Date() } }).sort({ createdAt: -1 }).session(dbSession);
      if (!claim) { outcome = { ok: false, text: 'Link đã hết hạn hoặc đã sử dụng. Vui lòng tạo link mới.' }; return; }
      const phone = normalizePhone(message.contact.phone_number);
      if (claim.purpose === 'guest') {
        if (claim.receiptId) {
          if (!require('./telegramReceiptService').enabled()) { outcome = { ok: false, text: 'Nhận vé theo SĐT hiện chưa được bật.' }; return; }
          const Receipt = require('../models/TelegramReceipt');
          const receipt = await Receipt.findOne({ _id: claim.receiptId, state: 'needs_link', authExpiresAt: { $gt: new Date() } }).select('+phone').session(dbSession);
          if (!receipt || receipt.phone !== phone) { outcome = { ok: false, text: 'Số điện thoại không khớp yêu cầu nhận vé hoặc link đã hết hạn.' }; return; }
          const ticket = await require('./parkingPassService').getPassTicket(receipt.passId, { session: dbSession });
          if (ticket.session?.status !== 'active' || ticket.pass.qrVersion !== receipt.passVersion) { outcome = { ok: false, text: 'Vé không còn hiệu lực.' }; return; }
          const locked = await Receipt.updateOne({ _id: receipt._id, state: 'needs_link' }, { $set: { state: 'queued' } }, { session: dbSession });
          if (!locked.modifiedCount) throw Object.assign(new Error('Receipt conflict'), { code: 'CLAIM_CONFLICT' });
          let recipient = { chatId: identity.boundChatId, telegramUserId: identity.boundTelegramUserId };
          if (claim.rememberRecipient && receipt.rememberRecipient) {
            const Recipient = require('../models/TelegramPhoneRecipient');
            const now = new Date();
            recipient = await Recipient.findOneAndUpdate({ phone }, { $set: {
              chatId: identity.boundChatId, telegramUserId: identity.boundTelegramUserId,
              verifiedAt: now, consentAt: now, expiresAt: new Date(now.getTime() + 90 * 86400000), revokedAt: null, blockedAt: null,
            }, $inc: { version: 1 } }, { new: true, upsert: true, session: dbSession });
            await Delivery.updateMany({ phoneRecipientId: recipient._id, recipientVersion: { $ne: recipient.version }, status: { $in: ['pending', 'uncertain'] } },
              { $set: { status: 'cancelled', errorCode: 'RECIPIENT_CHANGED' } }, { session: dbSession });
          }
          await require('./telegramReceiptService').enqueue(receipt, recipient, dbSession);
        } else {
        const record = await Session.findById(claim.sessionId).session(dbSession);
        if (!record || record.status !== 'active' || record.type !== 'WALK_IN' || normalizePhone(record.phone) !== phone) {
          outcome = { ok: false, text: 'Số điện thoại không khớp vé hoặc lượt gửi xe đã kết thúc. Vui lòng liên hệ nhân viên.' }; return;
        }
        await Delivery.updateOne({ dedupeKey: `guest:${claim._id}` }, { $setOnInsert: {
          dedupeKey: `guest:${claim._id}`, kind: 'guest_ticket', sessionId: claim.sessionId, passId: claim.passId,
          passVersion: claim.passVersion,
          chatId: identity.boundChatId, telegramUserId: identity.boundTelegramUserId,
        } }, { upsert: true, session: dbSession });
        }
      } else {
        const other = await Link.findOne({ telegramUserId: identity.boundTelegramUserId, userId: { $ne: claim.userId }, revokedAt: null }).session(dbSession);
        if (other) { outcome = { ok: false, text: 'Telegram này đã liên kết tài khoản VALO khác. Hãy hủy liên kết trước.' }; return; }
        await Link.findOneAndUpdate({ userId: claim.userId }, { $set: {
          telegramUserId: identity.boundTelegramUserId, chatId: identity.boundChatId, username: message.from.username || '',
          phone, notificationsEnabled: true, linkedAt: new Date(), revokedAt: null, blockedAt: null,
        } }, { upsert: true, session: dbSession });
        if (claim.bookingId) {
          const booking = await require('../models/Booking').findOne({ _id: claim.bookingId, userId: claim.userId, status: { $in: ['PAID', 'ACTIVE', 'PAUSED'] } }).session(dbSession);
          if (booking) await require('./telegramDeliveryService').enqueueBookingTicket(booking, { session: dbSession });
        }
      }
      const consumed = await Claim.updateOne({ _id: claim._id, consumedAt: null }, { $set: { consumedAt: new Date() } }, { session: dbSession });
      if (consumed.modifiedCount !== 1) throw Object.assign(new Error('Claim conflict'), { code: 'CLAIM_CONFLICT' });
      outcome = { ok: true, text: claim.purpose === 'guest' ? 'Đã xác nhận. VALO sẽ gửi QR vé của lượt gửi xe này.' : 'Đã liên kết Telegram với VALO. Các booking mới sẽ được gửi khi thanh toán thành công.' };
    });
  } finally { await dbSession.endSession(); }
  return outcome;
}
module.exports = { hashToken, validateOwnContact, createToken, createGuestClaim, bindStart, consumeContact };
