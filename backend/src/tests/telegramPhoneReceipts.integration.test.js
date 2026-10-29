const assert = require('node:assert/strict');
const test = require('node:test');
const crypto = require('node:crypto');
const path = require('node:path');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
Object.assign(process.env, {
  TELEGRAM_ENABLED: 'true', TELEGRAM_PHONE_RECEIPTS_ENABLED: 'true', TELEGRAM_BOT_USERNAME: 'valo_test_bot',
  TELEGRAM_BOT_TOKEN: 'synthetic-token-never-sent', PARKING_PASS_QR_SECRET: 'isolated-pass-secret', PARKING_PASS_ISSUE_ENABLED: 'true',
});
const Receipt = require('../models/TelegramReceipt');
const Recipient = require('../models/TelegramPhoneRecipient');
const Claim = require('../models/TelegramClaimToken');
const Delivery = require('../models/TelegramDelivery');
const Session = require('../models/Session');
const Pass = require('../models/ParkingPass');
const Booking = require('../models/Booking');
const Link = require('../models/TelegramLink');
const Device = require('../models/KioskDevice');
require('../models/ParkingFloor');
const service = require('../services/telegramReceiptService');
const claims = require('../services/telegramClaimService');
const passes = require('../services/parkingPassService');
const worker = require('../services/telegramWorker');
const client = require('../services/telegramClient');
const models = [Receipt, Recipient, Claim, Delivery, Session, Pass, Booking, Link, Device];
const request = { kioskDevice: { deviceId: 'isolated-kiosk' } };
const contact = (phone = '+84901234567', id = 101) => ({ from: { id }, chat: { id, type: 'private' }, contact: { user_id: id, phone_number: phone } });
const rawClaim = value => new URL(value.claimLink).searchParams.get('start');

test('phone Telegram receipts use isolated transactional state and no network', { timeout: 240000 }, async t => {
  const replica = await MongoMemoryReplSet.create({ binary: { downloadDir: path.resolve(__dirname, '../../../.mongodb-binaries') }, replSet: { count: 1 } });
  const originalPhoto = client.sendPhoto, originalMessage = client.sendMessage;
  const sent = [];
  client.sendPhoto = async chatId => { sent.push(chatId); return { message_id: sent.length }; };
  client.sendMessage = async () => ({ message_id: 1 });
  try {
    await mongoose.connect(replica.getUri(), { dbName: 'telegram_phone_isolated' });
    await Promise.all(models.map(model => model.init()));
    const reset = async () => { await Promise.all(models.map(model => model.deleteMany({}))); sent.length = 0; };
    const fixture = async (rememberRecipient = false) => {
      const parkingSession = await Session.create({ licensePlate: '51A22222', phone: '0901234567', type: 'WALK_IN', status: 'active' });
      const pass = await passes.ensureSessionPass(parkingSession);
      const token = crypto.randomBytes(32).toString('hex');
      const transaction = await mongoose.startSession();
      let receipt;
      try { await transaction.withTransaction(async () => { receipt = await service.prepare(parkingSession, pass, { phone: '0901234567', rememberRecipient }, request, transaction, token); }); }
      finally { await transaction.endSession(); }
      return { receipt, token, pass, parkingSession };
    };
    const linked = async (remember = true) => {
      const value = await fixture(remember);
      const initial = await service.initial(value.receipt, value.token);
      assert.equal(initial.state, 'needs_link');
      assert.equal(await claims.bindStart(contact(), rawClaim(initial)), true);
      assert.equal((await claims.consumeContact(contact())).ok, true);
      return value;
    };
    await t.test('real HTTP routes reject unauthenticated or unknown kiosks and expose only capability booleans', async () => {
      const express = require('express');
      const app = express(); app.use(express.json()); app.use(require('cookie-parser')());
      app.use('/api/telegram', require('../routes/telegramRoutes'));
      const server = await new Promise(resolve => { const listening = app.listen(0, '127.0.0.1', () => resolve(listening)); });
      try {
        const base = `http://127.0.0.1:${server.address().port}/api/telegram`;
        const post = headers => fetch(`${base}/receipts/status`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ receiptToken: 'a'.repeat(64) }) });
        assert.equal((await post({})).status, 401);
        assert.equal((await post({ 'X-Kiosk-Gate': 'ENTRY_1', Cookie: `valo_kiosk_ENTRY_1=${'b'.repeat(64)}` })).status, 401);
        const response = await fetch(`${base}/capabilities`);
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), { success: true, data: { phoneReceiptsEnabled: true, accountReceiptsEnabled: true } });
      } finally { await new Promise(resolve => server.close(resolve)); }
    });
    await t.test('booking receipt status enforces ownership and returns sent state for linked owner', async () => {
      await reset();
      const userId = new mongoose.Types.ObjectId();
      const booking = await Booking.create({ userId, licensePlate: '51A12345', floorId: new mongoose.Types.ObjectId(), parkingSlot: 'A1', scheduledStart: new Date(Date.now() + 86400000), scheduledEnd: new Date(Date.now() + 90000000), durationHours: 1, paymentMethod: 'wallet', status: 'PAID', paidAt: new Date(), prepaidAmount: 30000 });
      await assert.rejects(service.bookingStatus(String(booking._id), new mongoose.Types.ObjectId()), { statusCode: 404 });
      const link = await Link.create({ userId, telegramUserId: '101', chatId: '101' });
      const pass = await Pass.create({ bookingId: booking._id });
      const sentAt = new Date();
      await Delivery.create({ dedupeKey: 'owner-only', kind: 'booking_paid', bookingId: booking._id, passId: pass._id, linkId: link._id, chatId: '101', telegramUserId: '101', status: 'sent', sentAt });
      const result = await service.bookingStatus(String(booking._id), userId);
      assert.equal(result.state, 'sent'); assert.equal(result.sentAt.getTime(), sentAt.getTime());
      assert.deepEqual(Object.keys(result).sort(), ['sentAt', 'state']);
    });
    await t.test('requires explicit flags and valid normalized phone; disabled feature ignores payload', () => {
      assert.equal(service.parseRequest({ requested: false }), null);
      assert.deepEqual(service.parseRequest({ requested: true, phone: '+84901234567', rememberRecipient: false }), { phone: '0901234567', rememberRecipient: false });
      for (const input of [{ requested: 'true' }, { requested: true, phone: '123', rememberRecipient: true }, { requested: true, phone: '0901234567', rememberRecipient: 'yes' }, []]) assert.throws(() => service.parseRequest(input));
      process.env.TELEGRAM_PHONE_RECEIPTS_ENABLED = 'false';
      try { assert.equal(service.parseRequest({ requested: true, phone: 'invalid' }), null); }
      finally { process.env.TELEGRAM_PHONE_RECEIPTS_ENABLED = 'true'; }
    });
    await t.test('entry transaction rollback removes receipt; stored capability is hashed and kiosk scoped', async () => {
      await reset();
      const value = await fixture();
      const stored = await Receipt.findById(value.receipt._id).select('+tokenHash');
      assert.notEqual(stored.tokenHash, value.token);
      assert.equal(stored.tokenHash, crypto.createHash('sha256').update(value.token).digest('hex'));
      assert.equal(String((await service.authorize({ ...request, body: { receiptToken: value.token } }))._id), String(stored._id));
      await assert.rejects(service.authorize({ kioskDevice: { deviceId: 'other' }, body: { receiptToken: value.token } }), { statusCode: 403 });
      await Receipt.updateOne({ _id: stored._id }, { $set: { authExpiresAt: new Date(Date.now() - 1000) } });
      await assert.rejects(service.authorize({ ...request, body: { receiptToken: value.token } }), { statusCode: 403 });
      const dbSession = await mongoose.startSession();
      try { await assert.rejects(dbSession.withTransaction(async () => { await service.prepare({ ...value.parkingSession.toObject(), _id: new mongoose.Types.ObjectId() }, value.pass, { phone: '0901234567', rememberRecipient: false }, request, dbSession, 'b'.repeat(64)); throw new Error('rollback'); }), /rollback/); }
      finally { await dbSession.endSession(); }
      assert.equal(await Receipt.countDocuments(), 1);
    });
    await t.test('first receipt sends once without retaining phone mapping when remember is false', async () => {
      await reset(); const value = await linked(false);
      assert.equal(await Recipient.countDocuments(), 0);
      assert.equal(await Delivery.countDocuments({ receiptId: value.receipt._id }), 1);
      const delivery = await Delivery.findOne({ receiptId: value.receipt._id });
      assert.equal((await worker.processDelivery(delivery)).status, 'sent');
      assert.deepEqual(sent, ['101']);
    });
    await t.test('remembered own contact enables one automatic delivery for the next entry', async () => {
      await reset(); await linked();
      const recipient = await Recipient.findOne().select('+phone');
      assert.equal(recipient.phone, '0901234567'); assert.equal(recipient.chatId, '101');
      const next = await fixture();
      const state = await service.initial(next.receipt, next.token);
      assert.equal(state.state, 'pending'); assert.equal(state.claimLink, undefined);
      await Promise.all(Array.from({ length: 5 }, () => service.status(next.receipt)));
      assert.equal(await Delivery.countDocuments({ receiptId: next.receipt._id }), 1);
      const delivery = await Delivery.findOne({ receiptId: next.receipt._id });
      assert.equal(String(delivery.phoneRecipientId), String(recipient._id));
    });
    await t.test('mismatched contact preserves claim; concurrent valid contacts consume and enqueue once', async () => {
      await reset(); const value = await fixture(true);
      const initial = await service.initial(value.receipt, value.token);
      assert.equal(await claims.bindStart(contact(), rawClaim(initial)), true);
      assert.equal((await claims.consumeContact(contact('+84909999999'))).ok, false);
      assert.equal(await Claim.countDocuments({ consumedAt: null }), 1);
      const outcomes = await Promise.allSettled(Array.from({ length: 12 }, () => claims.consumeContact(contact())));
      assert.equal(outcomes.filter(value => value.status === 'fulfilled' && value.value.ok).length, 1);
      assert.equal(await Recipient.countDocuments(), 1);
      assert.equal(await Delivery.countDocuments({ receiptId: value.receipt._id }), 1);
    });
    await t.test('revoked and expired recipients require fresh verification', async () => {
      for (const invalidation of [{ revokedAt: new Date() }, { expiresAt: new Date(Date.now() - 1000) }, { blockedAt: new Date() }]) {
        await reset(); await linked();
        await Recipient.updateMany({}, { $set: invalidation });
        const value = await fixture(); const state = await service.initial(value.receipt, value.token);
        assert.equal(state.state, 'needs_link'); assert.ok(state.claimLink);
        assert.equal(await Delivery.countDocuments({ receiptId: value.receipt._id }), 0);
      }
    });
    await t.test('/stop revokes remembered recipient and cancels queued tickets', async () => {
      await reset(); await linked();
      const next = await fixture(); await service.initial(next.receipt, next.token);
      await worker.processUpdate({ payload: { message: { ...contact(), text: '/stop', contact: undefined } } });
      assert.ok((await Recipient.findOne()).revokedAt);
      assert.equal((await Delivery.findOne({ receiptId: next.receipt._id })).status, 'cancelled');
      assert.equal(sent.length, 0);
    });
    await t.test('blocked destination requires fresh proof and requeues the same delivery once', async () => {
      await reset(); await linked();
      const value = await fixture(); await service.initial(value.receipt, value.token);
      const original = await Delivery.findOne({ receiptId: value.receipt._id });
      await Delivery.updateOne({ _id: original._id }, { $set: { status: 'failed', errorCode: 'BOT_BLOCKED' } });
      await Recipient.updateMany({}, { $set: { blockedAt: new Date() } });
      const claim = await service.createClaim(value.receipt, true);
      assert.equal(await claims.bindStart(contact(), rawClaim(claim)), true);
      assert.equal((await claims.consumeContact(contact())).ok, true);
      const recovered = await Delivery.findOne({ receiptId: value.receipt._id });
      assert.equal(String(recovered._id), String(original._id));
      assert.equal(recovered.status, 'pending'); assert.equal(recovered.errorCode, undefined);
      assert.equal((await Recipient.findOne()).blockedAt, null);
      assert.equal(await Delivery.countDocuments({ receiptId: value.receipt._id }), 1);
    });
    await t.test('/stop cancels a one-time receipt without any remembered recipient', async () => {
      await reset(); const value = await linked(false);
      await worker.processUpdate({ payload: { message: { ...contact(), text: '/stop', contact: undefined } } });
      assert.equal(await Recipient.countDocuments(), 0);
      const delivery = await Delivery.findOne({ receiptId: value.receipt._id });
      assert.equal(delivery.status, 'cancelled'); assert.equal(sent.length, 0);
    });
    await t.test('reconcile recovers committed intents after response processing is interrupted', async () => {
      await reset(); await linked();
      const value = await fixture();
      assert.equal((await Receipt.findById(value.receipt._id)).state, 'prepared');
      assert.equal(await Delivery.countDocuments({ receiptId: value.receipt._id }), 0);
      await service.reconcile(); await service.reconcile();
      assert.equal(await Delivery.countDocuments({ receiptId: value.receipt._id }), 1);
      assert.equal((await Receipt.findById(value.receipt._id)).state, 'queued');
    });
    await t.test('uncertain phone receipt is retained for staff review without automatic acquisition', async () => {
      await reset(); const value = await linked(false);
      await Delivery.updateOne({ receiptId: value.receipt._id }, { $set: { status: 'uncertain', errorCode: 'SEND_UNCERTAIN', nextAttemptAt: new Date(Date.now() - 1000) } });
      await worker.runTelegramWorkerOnce();
      assert.equal((await Delivery.findOne({ receiptId: value.receipt._id })).status, 'uncertain');
      assert.equal(sent.length, 0);
    });
    await t.test('expired processing receipt becomes uncertain without another network send', async () => {
      await reset(); const value = await linked(false);
      await Delivery.updateOne({ receiptId: value.receipt._id }, { $set: { status: 'processing', leaseId: 'lost-worker', leaseUntil: new Date(Date.now() - 1000) } });
      await worker.runTelegramWorkerOnce();
      const delivery = await Delivery.findOne({ receiptId: value.receipt._id });
      assert.equal(delivery.status, 'uncertain'); assert.equal(sent.length, 0);
    });
    await t.test('worker refuses replaced recipient versions and revoked or reissued passes', async () => {
      for (const mode of ['recipient', 'revoked', 'version']) {
        await reset(); await linked();
        const value = await fixture(); await service.initial(value.receipt, value.token);
        const delivery = await Delivery.findOne({ receiptId: value.receipt._id });
        if (mode === 'recipient') await Recipient.updateMany({}, { $inc: { version: 1 } });
        else await Pass.updateOne({ _id: value.pass._id }, mode === 'revoked' ? { $set: { revokedAt: new Date() } } : { $inc: { qrVersion: 1 } });
        try { assert.equal((await worker.processDelivery(delivery)).status, 'cancelled'); }
        catch (error) { assert.ok([404, 410].includes(error.statusCode)); }
        assert.equal(sent.length, 0);
      }
    });
  } finally {
    client.sendPhoto = originalPhoto; client.sendMessage = originalMessage;
    await mongoose.disconnect(); await replica.stop();
  }
});
