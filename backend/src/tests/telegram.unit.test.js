const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const Claim = require('../models/TelegramClaimToken');
const Link = require('../models/TelegramLink');
const Session = require('../models/Session');
const Delivery = require('../models/TelegramDelivery');
const Update = require('../models/TelegramUpdate');
const claimService = require('../services/telegramClaimService');
const client = require('../services/telegramClient');
const worker = require('../services/telegramWorker');
const { verifyWebhookSecret, webhook } = require('../controllers/telegramController');
const { formatTicket } = require('../services/telegramDeliveryService');

function message(phone = '+84901234567') {
  return { from: { id: 101 }, chat: { id: 101, type: 'private' }, contact: { user_id: 101, phone_number: phone } };
}
function patches(t, target, values) {
  for (const [key, value] of Object.entries(values)) { const original = target[key]; target[key] = value; t.after(() => { target[key] = original; }); }
}
const query = value => ({ session: async () => value, sort() { return this; } });

test('contact must belong to sender and come from a private chat', () => {
  assert.equal(claimService.validateOwnContact(message()), true);
  assert.equal(claimService.validateOwnContact(message('+14155552671')), true);
  const forwarded = message(); forwarded.contact.user_id = 102;
  assert.equal(Boolean(claimService.validateOwnContact(forwarded)), false);
  const group = message(); group.chat.type = 'group';
  assert.equal(Boolean(claimService.validateOwnContact(group)), false);
});
test('webhook secret uses exact matching and fails closed when unconfigured', () => {
  assert.equal(verifyWebhookSecret('secret', 'secret'), true);
  for (const bad of ['secre', 'secret!', '', undefined]) assert.equal(verifyWebhookSecret(bad, 'secret'), false);
  assert.equal(verifyWebhookSecret('', ''), false);
});
test('Telegram retry follows 429 delay, blocked stops, timeout is uncertain', () => {
  const retry = client.classifyError({ response: { data: { error_code: 429, parameters: { retry_after: 37 } } } }, 1, 1000);
  assert.equal(retry.nextAttemptAt.getTime(), 38000);
  assert.equal(retry.status, 'pending');
  assert.equal(client.classifyError({ response: { status: 403 } }).errorCode, 'BOT_BLOCKED');
  assert.equal(client.classifyError({ code: 'ECONNABORTED' }, 5).status, 'uncertain');
  assert.equal(client.classifyError({}, 5).status, 'failed');
});
test('Start binds a token once to a Telegram identity without raw token persistence', async t => {
  let filter, update;
  patches(t, Claim, { findOneAndUpdate: async (f, u) => { filter = f; update = u; return {}; } });
  const raw = 'A'.repeat(32);
  assert.equal(await claimService.bindStart(message(), raw), true);
  assert.equal(filter.tokenHash, claimService.hashToken(raw));
  assert.equal(JSON.stringify(filter).includes(raw), false);
  assert.deepEqual(update.$set, { boundTelegramUserId: '101', boundChatId: '101' });
  assert.ok(filter.expiresAt.$gt instanceof Date);
  assert.deepEqual(filter.$or[1], update.$set);
  assert.equal(await claimService.bindStart(message(), 'invalid token'), false);
});
test('guest contact mismatch does not consume token or enqueue another customer ticket', async t => {
  let consumed = false, queued = false;
  patches(t, mongoose, { startSession: async () => ({ withTransaction: async fn => fn(), endSession: async () => {} }) });
  patches(t, Claim, { findOne: () => query({ _id: 'claim', purpose: 'guest', sessionId: 'session', passId: 'pass' }), updateOne: async () => { consumed = true; } });
  patches(t, Session, { findById: () => query({ status: 'active', type: 'WALK_IN', phone: '0909999999' }) });
  patches(t, Delivery, { updateOne: async () => { queued = true; } });
  const result = await claimService.consumeContact(message());
  assert.equal(result.ok, false); assert.equal(consumed, false); assert.equal(queued, false);
});
test('guest claim creates only scoped delivery and consumes in same transaction', async t => {
  const dbSession = { withTransaction: async fn => fn(), endSession: async () => {} };
  let delivery, consumeOptions, linkTouched = false;
  patches(t, mongoose, { startSession: async () => dbSession });
  patches(t, Claim, { findOne: () => query({ _id: 'claim', purpose: 'guest', sessionId: 'session', passId: 'pass' }), updateOne: async (f, u, options) => { consumeOptions = options; return { modifiedCount: 1 }; } });
  patches(t, Session, { findById: () => query({ status: 'active', type: 'WALK_IN', phone: '0901234567' }) });
  patches(t, Delivery, { updateOne: async (f, u, options) => { delivery = { f, u, options }; } });
  patches(t, Link, { findOne: () => { linkTouched = true; throw new Error('guest must not link account'); } });
  const result = await claimService.consumeContact(message());
  assert.equal(result.ok, true); assert.equal(linkTouched, false);
  assert.equal(delivery.u.$setOnInsert.sessionId, 'session');
  assert.equal(delivery.options.session, dbSession); assert.equal(consumeOptions.session, dbSession);
});
test('lease acquisition atomically reclaims expired worker and completion checks owner', async t => {
  let filter, mutation, completion;
  patches(t, Update, { findOneAndUpdate: (f, u) => { filter = f; mutation = u; return { select: async () => ({ _id: 'update', leaseId: u.$set.leaseId }) }; }, updateOne: async (f, u) => { completion = { f, u }; } });
  const leased = await worker.acquireLease(Update, ['pending']);
  assert.equal(filter.$or[1].status, 'processing'); assert.ok(filter.$or[1].leaseUntil.$lte instanceof Date);
  assert.equal(mutation.$inc.attempts, 1);
  await worker.finish(Update, leased, { status: 'done' });
  assert.equal(completion.f.leaseId, leased.leaseId); assert.equal(completion.f.status, 'processing');
  assert.equal(completion.u.$unset.payload, 1);
});
test('revoked link cancels pending delivery before looking up or sending ticket', async t => {
  patches(t, Link, { findOne: async () => null });
  let sent = false; patches(t, client, { sendPhoto: async () => { sent = true; } });
  const result = await worker.processDelivery({ linkId: 'link', chatId: '101', telegramUserId: '101' });
  assert.equal(result.status, 'cancelled'); assert.equal(sent, false);
});
test('webhook acknowledges only after durable upsert and duplicate update is harmless', async t => {
  const priorEnabled = process.env.TELEGRAM_ENABLED, priorSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  process.env.TELEGRAM_ENABLED = 'true'; process.env.TELEGRAM_WEBHOOK_SECRET = 'secret';
  t.after(() => { if (priorEnabled === undefined) delete process.env.TELEGRAM_ENABLED; else process.env.TELEGRAM_ENABLED = priorEnabled; if (priorSecret === undefined) delete process.env.TELEGRAM_WEBHOOK_SECRET; else process.env.TELEGRAM_WEBHOOK_SECRET = priorSecret; });
  let persisted = false, status;
  patches(t, Update, { updateOne: async () => { persisted = true; } });
  const req = { get: () => 'secret', body: { update_id: 12, message: message() } };
  const res = { sendStatus: n => { assert.equal(persisted, true); status = n; } };
  await webhook(req, res); assert.equal(status, 200);
  patches(t, Update, { updateOne: async () => { throw Object.assign(new Error(), { code: 11000 }); } });
  await webhook(req, res); assert.equal(status, 200);
});
test('caption uses Vietnam timezone and advertises same QR for both channels', () => {
  const caption = formatTicket({ pass: { _id: 'pass' }, booking: { licensePlate: '51A12345', parkingSlot: 'A1', scheduledStart: '2026-10-08T07:00:00Z', scheduledEnd: '2026-10-08T08:00:00Z' } });
  assert.ok(caption.includes('14:00')); assert.ok(caption.includes('check-in/checkout'));
});
test('booking-specific link request rejects someone else booking before revoking tokens', async t => {
  const Booking = require('../models/Booking');
  const linkService = require('../services/telegramLinkService');
  let revoked = false;
  patches(t, Booking, { exists: async filter => { assert.equal(filter.userId, 'owner'); return null; } });
  patches(t, Claim, { updateMany: async () => { revoked = true; } });
  await assert.rejects(linkService.createLinkToken('owner', 'a'.repeat(24)), error => error.statusCode === 404);
  assert.equal(revoked, false);
});
test('future paid booking sends a scannable PNG despite closed check-in window', async t => {
  const passService = require('../services/parkingPassService');
  patches(t, passService, { getPassTicket: async () => ({ pass: { _id: 'pass', qrVersion: 1 }, booking: { status: 'PAID', parkingSlot: 'A1' }, payload: 'VALO_TEST_PAYLOAD', allowedActions: [] }) });
  let photo;
  patches(t, client, { sendPhoto: async (chat, png) => { photo = png; assert.equal(chat, '101'); return { message_id: 42 }; } });
  const result = await worker.processDelivery({ kind: 'booking_paid', passId: 'pass', passVersion: 1, chatId: '101' });
  assert.equal(result.status, 'sent'); assert.equal(result.messageId, 42);
  assert.equal(photo.subarray(1, 4).toString(), 'PNG');
});
test('superseded guest pass version is cancelled without sending', async t => {
  const passService = require('../services/parkingPassService');
  patches(t, passService, { getPassTicket: async () => ({ pass: { qrVersion: 2 }, session: { _id: 'session', status: 'active' }, payload: 'new QR' }) });
  let sent = false; patches(t, client, { sendPhoto: async () => { sent = true; } });
  const result = await worker.processDelivery({ kind: 'guest_ticket', passId: 'pass', sessionId: 'session', passVersion: 1 });
  assert.equal(result.status, 'cancelled'); assert.equal(sent, false);
});
test('unlink revokes account, open tokens and queued deliveries within one transaction', async t => {
  const linkService = require('../services/telegramLinkService');
  const session = { withTransaction: async fn => fn(), endSession: async () => {} };
  const observed = [];
  patches(t, mongoose, { startSession: async () => session });
  patches(t, Link, { findOneAndUpdate: async (f, u, options) => { observed.push(options.session); return { _id: 'link' }; } });
  patches(t, Claim, { updateMany: async (f, u, options) => { observed.push(options.session); assert.equal(f.consumedAt, null); } });
  patches(t, Delivery, { updateMany: async (f, u, options) => { observed.push(options.session); assert.equal(u.$set.status, 'cancelled'); } });
  await linkService.unlink('owner');
  assert.deepEqual(observed, [session, session, session]);
});
