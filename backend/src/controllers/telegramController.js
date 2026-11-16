const crypto = require('crypto');
const { storeUpdate } = require('../services/telegramUpdateService');
const service = require('../services/telegramLinkService');
const client = require('../services/telegramClient');
function verifyWebhookSecret(value, secret = process.env.TELEGRAM_WEBHOOK_SECRET) {
  if (!secret || typeof value !== 'string') return false;
  const actual = Buffer.from(value), expected = Buffer.from(secret);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}
const respond = handler => async (req, res) => {
  try { res.json({ success: true, data: await handler(req) }); }
  catch (error) { res.status(error.statusCode || 500).json({ success: false, code: error.code || 'TELEGRAM_ERROR', message: error.statusCode ? error.message : 'Không thể xử lý Telegram lúc này.' }); }
};
const getLink = respond(req => service.getStatus(req.user._id));
const createLinkToken = respond(req => service.createLinkToken(req.user._id, req.body?.bookingId));
const preferences = respond(req => {
  if (typeof req.body?.notificationsEnabled !== 'boolean') throw Object.assign(new Error('notificationsEnabled phải là boolean'), { statusCode: 400, code: 'INVALID_PREFERENCE' });
  return service.preferences(req.user._id, req.body.notificationsEnabled);
});
const unlink = respond(async req => { await service.unlink(req.user._id); return { linked: false, notificationsEnabled: false }; });
const receiptService = require('../services/telegramReceiptService');
const receiptStatus = respond(async req => receiptService.status(await receiptService.authorize(req)));
const receiptClaim = respond(async req => receiptService.createClaim(await receiptService.authorize(req), req.body?.rememberRecipient));
const receiptRetry = respond(async req => receiptService.retry(await receiptService.authorize(req)));
const bookingReceipt = respond(req => receiptService.bookingStatus(req.params.bookingId, req.user._id));
async function webhook(req, res) {
  if (!client.enabled()) return res.sendStatus(503);
  if (!verifyWebhookSecret(req.get('X-Telegram-Bot-Api-Secret-Token'))) return res.sendStatus(403);
  if (!Number.isSafeInteger(req.body?.update_id)) return res.sendStatus(400);
  try {
    await storeUpdate(req.body);
    return res.sendStatus(200);
  } catch (error) {
    if (error.code === 11000) return res.sendStatus(200);
    return res.sendStatus(503);
  }
}
module.exports = { getLink, createLinkToken, preferences, unlink, webhook, verifyWebhookSecret, receiptStatus, receiptClaim, receiptRetry, bookingReceipt };
