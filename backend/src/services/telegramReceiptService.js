const crypto = require('crypto');
const mongoose = require('mongoose');
const Receipt = require('../models/TelegramReceipt');
const Recipient = require('../models/TelegramPhoneRecipient');
const Delivery = require('../models/TelegramDelivery');
const Claim = require('../models/TelegramClaimToken');
const { normalizePhone } = require('../utils/phoneUtils');
const client = require('./telegramClient');

const enabled = () => client.enabled() && process.env.TELEGRAM_PHONE_RECEIPTS_ENABLED === 'true';
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const fail = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });
const principal = req => req.kioskDevice ? `kiosk:${req.kioskDevice.deviceId}` : req.user ? `staff:${req.user._id}` : '';
function parseRequest(input) {
  if (!input || !enabled()) return null;
  if (typeof input !== 'object' || Array.isArray(input) || typeof input.requested !== 'boolean') throw fail('Yêu cầu nhận vé không hợp lệ');
  if (!input.requested) return null;
  const phone = normalizePhone(input.phone);
  if (!/^0\d{9}$/.test(phone) || typeof input.rememberRecipient !== 'boolean') throw fail('SĐT nhận vé không hợp lệ');
  return { phone, rememberRecipient: input.rememberRecipient };
}
// Persist the intent in the same transaction as entry. The raw capability only lives in the response.
async function prepare(parkingSession, pass, input, req, session, token) {
  if (!input || !enabled() || parkingSession.type !== 'WALK_IN' || !pass) return null;
  const [receipt] = await Receipt.create([{
    sessionId: parkingSession._id, passId: pass._id, passVersion: pass.qrVersion,
    phone: input.phone, rememberRecipient: input.rememberRecipient,
    principal: principal(req), tokenHash: hash(token), authExpiresAt: new Date(Date.now() + 15 * 60000),
  }], { session });
  return receipt;
}
async function enqueue(receipt, recipient, session) {
  const fields = {
    kind: 'guest_ticket', receiptId: receipt._id, sessionId: receipt.sessionId,
    passId: receipt.passId, passVersion: receipt.passVersion,
    chatId: recipient.chatId, telegramUserId: recipient.telegramUserId,
    ...(recipient._id ? { phoneRecipientId: recipient._id, recipientVersion: recipient.version } : {}),
  };
  const delivery = await Delivery.findOneAndUpdate({ dedupeKey: `receipt:${receipt._id}` }, { $setOnInsert: fields }, { upsert: true, new: true, session });
  // Only a newly verified contact can recover a definitively cancelled/blocked destination.
  if (['failed', 'cancelled'].includes(delivery.status) && ['BOT_BLOCKED', 'RECIPIENT_CHANGED', 'RECIPIENT_REVOKED'].includes(delivery.errorCode)) {
    await Delivery.updateOne({ _id: delivery._id, status: delivery.status, errorCode: delivery.errorCode },
      { $set: { ...fields, status: 'pending', attempts: 0, nextAttemptAt: new Date() },
        $unset: { errorCode: 1, ...(!recipient._id ? { phoneRecipientId: 1, recipientVersion: 1 } : {}) } }, { session });
  }
  return delivery;
}
async function processIntent(id) {
  if (!enabled()) return;
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const receipt = await Receipt.findOneAndUpdate({ _id: id, state: 'prepared' }, { $set: { state: 'needs_link' } }, { new: true, session }).select('+phone');
      if (!receipt) return;
      const ticket = await require('./parkingPassService').getPassTicket(receipt.passId, { session });
      if (ticket.session?.status !== 'active' || ticket.pass.qrVersion !== receipt.passVersion) {
        receipt.state = 'cancelled'; await receipt.save({ session }); return;
      }
      const recipient = await Recipient.findOne({ phone: receipt.phone, revokedAt: null, blockedAt: null,
        expiresAt: { $gt: new Date() }, verifiedAt: { $lte: receipt.createdAt } }).session(session);
      if (!recipient) return;
      await enqueue(receipt, recipient, session);
      receipt.state = 'queued'; await receipt.save({ session });
    });
  } finally { await session.endSession(); }
}
async function authorize(req) {
  const token = req.body?.receiptToken;
  if (!enabled()) throw fail('Telegram nhận vé theo SĐT chưa được bật', 503);
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) throw fail('Phiên nhận vé không hợp lệ', 403);
  const receipt = await Receipt.findOne({ tokenHash: hash(token), principal: principal(req), authExpiresAt: { $gt: new Date() } }).select('+phone');
  if (!receipt) throw fail('Phiên nhận vé đã hết hạn hoặc không hợp lệ', 403);
  return receipt;
}
async function status(receipt) {
  if (!enabled()) return { state: 'disabled' };
  await processIntent(receipt._id);
  const current = await Receipt.findById(receipt._id);
  const delivery = await Delivery.findOne({ receiptId: receipt._id }).lean();
  const bound = !delivery && await Claim.exists({ receiptId: receipt._id, consumedAt: null, revokedAt: null, expiresAt: { $gt: new Date() }, boundTelegramUserId: { $exists: true } });
  return { state: delivery?.status || (bound ? 'awaiting_contact' : current.state === 'prepared' ? 'queued' : current.state),
    ...(delivery?.sentAt ? { sentAt: delivery.sentAt } : {}), ...(delivery?.errorCode ? { errorCode: delivery.errorCode } : {}) };
}
async function createClaim(receipt, rememberRecipient) {
  const now = new Date();
  const s = await mongoose.startSession();
  let result;
  try {
    await s.withTransaction(async () => {
      const delivery = await Delivery.findOne({ receiptId: receipt._id }).session(s);
      if (delivery && ['failed', 'cancelled'].includes(delivery.status) && ['BOT_BLOCKED', 'RECIPIENT_CHANGED', 'RECIPIENT_REVOKED'].includes(delivery.errorCode)) {
        await Receipt.updateOne({ _id: receipt._id, state: 'queued' }, { $set: { state: 'needs_link' } }, { session: s });
      }
      const locked = await Receipt.findOneAndUpdate({ _id: receipt._id, state: 'needs_link', authExpiresAt: { $gt: now },
        $or: [{ lastClaimAt: null }, { lastClaimAt: { $lte: new Date(now - 15000) } }] },
      { $set: { lastClaimAt: now, ...(typeof rememberRecipient === 'boolean' ? { rememberRecipient } : {}) } }, { new: true, session: s }).select('+phone');
      if (!locked) throw fail('Vui lòng chờ trước khi tạo link nhận vé mới', 429);
      const ticket = await require('./parkingPassService').getPassTicket(locked.passId, { session: s });
      if (ticket.session?.status !== 'active' || ticket.pass.qrVersion !== locked.passVersion) throw fail('Vé không còn hiệu lực', 410);
      await Claim.updateMany({ receiptId: locked._id, consumedAt: null }, { $set: { revokedAt: now } }, { session: s });
      const claim = await require('./telegramClaimService').createToken({ purpose: 'guest', receiptId: locked._id,
        sessionId: locked.sessionId, passId: locked.passId, passVersion: locked.passVersion,
        recipientPhone: locked.phone, rememberRecipient: locked.rememberRecipient }, { session: s });
      result = { state: 'needs_link', claimLink: claim.deepLink, claimExpiresAt: claim.expiresAt };
    });
  } finally { await s.endSession(); }
  return result;
}
async function initial(receipt, token) {
  await processIntent(receipt._id);
  const state = await status(receipt);
  return { ...state, receiptToken: token, tokenExpiresAt: receipt.authExpiresAt,
    ...(state.state === 'needs_link' ? await createClaim(receipt) : {}) };
}
async function retry(receipt) {
  const now = new Date();
  const s = await mongoose.startSession();
  try {
    await s.withTransaction(async () => {
      const locked = await Receipt.findOneAndUpdate({ _id: receipt._id, retryCount: { $lt: 2 },
        $or: [{ lastRetryAt: null }, { lastRetryAt: { $lte: new Date(now - 30000) } }] },
      { $set: { lastRetryAt: now }, $inc: { retryCount: 1 } }, { new: true, session: s });
      if (!locked) throw fail('Vui lòng chờ hoặc liên hệ nhân viên', 429);
      const ticket = await require('./parkingPassService').getPassTicket(receipt.passId, { session: s });
      if (ticket.session?.status !== 'active' || ticket.pass.qrVersion !== receipt.passVersion) throw fail('Vé không còn hiệu lực', 410);
      const delivery = await Delivery.findOne({ receiptId: receipt._id }).session(s);
      if (delivery?.phoneRecipientId && !await Recipient.exists({ _id: delivery.phoneRecipientId, version: delivery.recipientVersion,
        revokedAt: null, blockedAt: null, expiresAt: { $gt: now }, chatId: delivery.chatId, telegramUserId: delivery.telegramUserId }).session(s)) throw fail('Vui lòng liên kết lại Telegram', 409);
      const updated = await Delivery.updateOne({ receiptId: receipt._id, status: 'failed', errorCode: { $in: ['BOT_UNAVAILABLE', 'RATE_LIMIT', 'RETRY_EXHAUSTED'] } },
        { $set: { status: 'pending', attempts: 0, nextAttemptAt: now }, $unset: { errorCode: 1 } }, { session: s });
      if (!updated.modifiedCount) throw fail('Không thể gửi lại vé ở trạng thái hiện tại', 409);
    });
  } finally { await s.endSession(); }
  return status(receipt);
}
async function reconcile() {
  if (!enabled()) return;
  const receipts = await Receipt.find({ state: 'prepared', createdAt: { $gte: new Date(Date.now() - 86400000) } }).sort({ createdAt: 1 }).limit(100);
  for (const receipt of receipts) await processIntent(receipt._id);
}
async function stop(message) {
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const identity = { telegramUserId: String(message.from.id), chatId: String(message.chat.id) };
      await Recipient.updateMany(identity, { $set: { revokedAt: new Date() }, $inc: { version: 1 } }, { session });
      await Delivery.updateMany({ ...identity, receiptId: { $exists: true }, status: { $in: ['pending', 'processing', 'uncertain'] } },
        { $set: { status: 'cancelled', errorCode: 'RECIPIENT_REVOKED' } }, { session });
      await Claim.updateMany({ purpose: 'guest', receiptId: { $exists: true }, boundTelegramUserId: identity.telegramUserId,
        boundChatId: identity.chatId, consumedAt: null }, { $set: { revokedAt: new Date() } }, { session });
    });
  } finally { await session.endSession(); }
}
async function bookingStatus(bookingId, userId) {
  if (!mongoose.isValidObjectId(bookingId)) throw fail('Booking không hợp lệ');
  const booking = await require('../models/Booking').findOne({ _id: bookingId, userId });
  if (!booking) throw fail('Không tìm thấy booking', 404);
  if (!client.enabled()) return { state: 'disabled' };
  const link = await require('../models/TelegramLink').findOne({ userId, revokedAt: null });
  if (!link || link.blockedAt || !link.notificationsEnabled) return { state: 'needs_link' };
  const delivery = await Delivery.findOne({ bookingId, linkId: link._id }).sort({ createdAt: -1 }).lean();
  return { state: delivery?.status || 'needs_link', ...(delivery?.errorCode ? { errorCode: delivery.errorCode } : {}), ...(delivery?.sentAt ? { sentAt: delivery.sentAt } : {}) };
}
module.exports = { enabled, parseRequest, prepare, enqueue, authorize, status, createClaim, initial, retry, reconcile, stop, bookingStatus };
