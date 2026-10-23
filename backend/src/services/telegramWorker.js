const crypto = require('crypto');
const Update = require('../models/TelegramUpdate');
const Delivery = require('../models/TelegramDelivery');
const Link = require('../models/TelegramLink');
const client = require('./telegramClient');
const { bindStart, consumeContact } = require('./telegramClaimService');
const { formatTicket } = require('./telegramDeliveryService');

async function acquireLease(Model, statuses, extraFilter = {}) {
  const now = new Date();
  return Model.findOneAndUpdate({
    ...extraFilter,
    $or: [{ status: { $in: statuses }, nextAttemptAt: { $lte: now } }, { status: 'processing', leaseUntil: { $lte: now } }],
  }, { $set: { status: 'processing', leaseUntil: new Date(Date.now() + 60000), leaseId: crypto.randomUUID() }, $inc: { attempts: 1 } },
  { sort: { createdAt: 1 }, new: true }).select('+payload');
}
async function finish(Model, record, changes) {
  const clear = { leaseUntil: 1, leaseId: 1 };
  if (Model === Update && ['done', 'failed'].includes(changes.status)) clear.payload = 1;
  return Model.updateOne({ _id: record._id, leaseId: record.leaseId, status: 'processing' }, {
    $set: changes, $unset: clear,
  });
}
async function processUpdate(record) {
  const message = record.payload?.message;
  if (!message || message.chat?.type !== 'private' || !message.from?.id || !message.chat?.id) return;
  const start = /^\/start(?:@[A-Za-z0-9_]+)?(?:\s+([A-Za-z0-9_-]+))?$/.exec(message.text || '');
  if (/^\/stop(?:@[A-Za-z0-9_]+)?\s*$/.test(message.text || '')) {
    await require('./telegramReceiptService').stop(message);
    await client.sendMessage(String(message.chat.id), 'Đã tắt ghi nhớ nhận vé theo SĐT. Liên kết tài khoản VALO được quản lý riêng trong ứng dụng.', { remove_keyboard: true });
  } else if (start) {
    const valid = start[1] && await bindStart(message, start[1]);
    await client.sendMessage(String(message.chat.id), valid ? 'Để xác nhận người nhận vé, hãy chia sẻ số điện thoại của chính bạn.' : 'Hãy mở link nhận vé từ VALO hoặc kiosk. Link có hiệu lực 10 phút.', valid ? {
      keyboard: [[{ text: 'Chia sẻ số điện thoại của tôi', request_contact: true }]], resize_keyboard: true, one_time_keyboard: true,
    } : undefined);
  } else if (message.contact) {
    const result = await consumeContact(message);
    await client.sendMessage(String(message.chat.id), result.text, { remove_keyboard: true });
  }
}
async function processDelivery(record) {
  if (record.receiptId && !require('./telegramReceiptService').enabled()) return { status: 'cancelled', errorCode: 'PHONE_RECEIPTS_DISABLED' };
  const recipientFilter = record.phoneRecipientId ? {
    _id: record.phoneRecipientId, version: record.recipientVersion, revokedAt: null, blockedAt: null,
    expiresAt: { $gt: new Date() }, chatId: record.chatId, telegramUserId: record.telegramUserId,
  } : null;
  if (recipientFilter && !await require('../models/TelegramPhoneRecipient').exists(recipientFilter)) return { status: 'cancelled', errorCode: 'RECIPIENT_CHANGED' };
  if (record.linkId) {
    const link = await Link.findOne({ _id: record.linkId, revokedAt: null, blockedAt: null, notificationsEnabled: true,
      chatId: record.chatId, telegramUserId: record.telegramUserId });
    if (!link || record.createdAt < link.linkedAt) return { status: 'cancelled', errorCode: 'LINK_CHANGED' };
  }
  const ticket = await require('./parkingPassService').getPassTicket(record.passId);
  const version = ticket.pass.qrVersion || ticket.pass.credentialVersion || ticket.pass.version;
  const usable = ticket.booking ? ['PAID', 'ACTIVE', 'PAUSED'].includes(ticket.booking.status) : ticket.session?.status === 'active';
  if (ticket.pass.revokedAt || (record.passVersion != null && record.passVersion !== version) || !usable || !ticket.payload) {
    return { status: 'cancelled', errorCode: 'TICKET_NO_LONGER_VALID' };
  }
  // Guest claims remain scoped to the session they proved, never a phone-based history lookup.
  if (record.kind === 'guest_ticket' && String(ticket.session?._id) !== String(record.sessionId)) {
    return { status: 'cancelled', errorCode: 'SESSION_CHANGED' };
  }
  const png = await require('qrcode').toBuffer(ticket.payload, { type: 'png', width: 700, margin: 4, errorCorrectionLevel: 'M' });
  // Recheck recipient immediately before the network side effect.
  if (record.linkId && !await Link.exists({ _id: record.linkId, revokedAt: null, blockedAt: null, notificationsEnabled: true, chatId: record.chatId, telegramUserId: record.telegramUserId })) {
    return { status: 'cancelled', errorCode: 'LINK_CHANGED' };
  }
  if (recipientFilter && !await require('../models/TelegramPhoneRecipient').exists({ ...recipientFilter, expiresAt: { $gt: new Date() } })) return { status: 'cancelled', errorCode: 'RECIPIENT_CHANGED' };
  if (record.receiptId && !await Delivery.exists({ _id: record._id, status: { $nin: ['cancelled', 'failed'] } })) return { status: 'cancelled', errorCode: 'RECIPIENT_REVOKED' };
  const sent = await client.sendPhoto(record.chatId, png, formatTicket(ticket));
  return { status: 'sent', sentAt: new Date(), messageId: sent.message_id };
}
async function runTelegramWorkerOnce() {
  if (!client.enabled()) return;
  const update = await acquireLease(Update, ['pending']);
  if (update) {
    if (update.attempts > 5) {
      await finish(Update, update, { status: 'failed', errorCode: 'RETRY_EXHAUSTED' });
      return;
    }
    try { await processUpdate(update); await finish(Update, update, { status: 'done' }); }
    catch (error) {
      const retry = client.classifyError(error, update.attempts);
      // Updates may safely replay business handling; consumed tokens prevent repeated ownership changes.
      if (retry.status === 'uncertain') retry.status = update.attempts >= 5 ? 'failed' : 'pending';
      await finish(Update, update, retry);
    }
  }
  // A crashed sender may have reached Telegram before it could persist the result.
  // Preserve that ambiguity instead of resending a phone receipt after lease expiry.
  await Delivery.updateMany({ receiptId: { $exists: true }, status: 'processing', leaseUntil: { $lte: new Date() } }, {
    $set: { status: 'uncertain', errorCode: 'SEND_UNCERTAIN', nextAttemptAt: new Date('9999-12-31') },
    $unset: { leaseId: 1, leaseUntil: 1 },
  });
  const delivery = await acquireLease(Delivery, ['pending', 'uncertain'], {
    $nor: [{ status: { $in: ['uncertain', 'processing'] }, receiptId: { $exists: true } }],
  });
  if (delivery) {
    if (delivery.attempts > 5) {
      await finish(Delivery, delivery, { status: 'uncertain', errorCode: 'SEND_UNCERTAIN', nextAttemptAt: new Date('9999-12-31') });
      return;
    }
    try { await finish(Delivery, delivery, await processDelivery(delivery)); }
    catch (error) {
      if ([404, 410].includes(error.statusCode)) {
        await finish(Delivery, delivery, { status: 'cancelled', errorCode: 'TICKET_NO_LONGER_VALID' });
        return;
      }
      const retry = client.classifyError(error, delivery.attempts);
      if (retry.errorCode === 'BOT_BLOCKED' && delivery.linkId) await Link.updateOne({ _id: delivery.linkId, chatId: delivery.chatId }, { $set: { blockedAt: new Date() } });
      if (retry.errorCode === 'BOT_BLOCKED' && delivery.phoneRecipientId) await require('../models/TelegramPhoneRecipient').updateOne({ _id: delivery.phoneRecipientId, version: delivery.recipientVersion }, { $set: { blockedAt: new Date() } });
      // Terminal uncertainty is retained, not automatically replayed indefinitely.
      if (retry.status === 'uncertain' && delivery.attempts >= 5) retry.nextAttemptAt = new Date('9999-12-31');
      await finish(Delivery, delivery, retry);
    }
  }
}
function startTelegramWorker() {
  if (!client.enabled()) return () => {};
  let stopped = false, running = false;
  let lastReconcile = 0;
  const tick = async () => {
    if (stopped || running) return;
    running = true;
    try {
      await runTelegramWorkerOnce();
      if (Date.now() - lastReconcile > 60000) {
        lastReconcile = Date.now();
        await require('./telegramReconciler').reconcileTelegramBookings();
        await require('./telegramReceiptService').reconcile();
      }
    }
    catch (_) { console.warn('[Telegram] worker cycle failed'); }
    finally { running = false; }
  };
  const timer = setInterval(tick, 1000); timer.unref();
  tick();
  return () => { stopped = true; clearInterval(timer); };
}
module.exports = { acquireLease, finish, processUpdate, processDelivery, runTelegramWorkerOnce, startTelegramWorker };
