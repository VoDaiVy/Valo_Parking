const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');

Object.assign(process.env, {
  TELEGRAM_ENABLED: 'true', TELEGRAM_BOT_USERNAME: 'valo_test_bot', TELEGRAM_WEBHOOK_SECRET: 'isolated-webhook-secret',
  TELEGRAM_BOT_TOKEN: 'synthetic-token-never-sent',
  PARKING_PASS_QR_SECRET: 'isolated-pass-secret', PARKING_PASS_ISSUE_ENABLED: 'true',
});
const Claim = require('../models/TelegramClaimToken');
const Link = require('../models/TelegramLink');
const Delivery = require('../models/TelegramDelivery');
const Update = require('../models/TelegramUpdate');
const Session = require('../models/Session');
const Booking = require('../models/Booking');
const Pass = require('../models/ParkingPass');
const UserDetail = require('../models/UserDetail');
const User = require('../models/User');
const profileController = require('../controllers/profileController');
const deliveryService = require('../services/telegramDeliveryService');
const receiptService = require('../services/telegramReceiptService');
require('../models/ParkingFloor');
const passService = require('../services/parkingPassService');
const claimService = require('../services/telegramClaimService');
const linkService = require('../services/telegramLinkService');
const worker = require('../services/telegramWorker');
const controller = require('../controllers/telegramController');
const client = require('../services/telegramClient');
const paidPolicy = require('../services/paidBookingPolicyService');
const models = [Claim, Link, Delivery, Update, Session, Booking, Pass, UserDetail, User];
const contact = (id = 101, phone = '+84901234567') => ({ from: { id, username: 'isolated_user' }, chat: { id, type: 'private' }, contact: { user_id: id, phone_number: phone } });
const tokenFrom = result => new URL(result.deepLink).searchParams.get('start');
const newBooking = (userId, status = 'PAID') => Booking.create({ userId, licensePlate: '51A12345', floorId: new mongoose.Types.ObjectId(), parkingSlot: 'A1', scheduledStart: new Date(Date.now() + 86400000), scheduledEnd: new Date(Date.now() + 90000000), durationHours: 1, paymentMethod: 'wallet', status, paidAt: status === 'PAID' ? new Date() : null, prepaidAmount: 30000 });

test('Telegram claims and durable queues on an isolated Mongo replica set', { timeout: 240000 }, async t => {
  const replica = await MongoMemoryReplSet.create({ binary: { downloadDir: path.resolve(__dirname, '../../../.mongodb-binaries') }, replSet: { count: 1 } });
  const originalPhoto = client.sendPhoto, originalMessage = client.sendMessage;
  const sent = [];
  client.sendPhoto = async (chatId, png) => { assert.equal(png.subarray(1, 4).toString(), 'PNG'); sent.push(chatId); return { message_id: sent.length }; };
  client.sendMessage = async () => ({ message_id: 1 });
  try {
    await mongoose.connect(replica.getUri(), { dbName: 'telegram_isolated_tests' });
    await Promise.all(models.map(model => model.init()));
    const reset = async () => { await Promise.all(models.map(model => model.deleteMany({}))); sent.length = 0; };

    await t.test('actual PENDING-to-PAID policy atomically writes booking, pass and Telegram outbox once', async () => {
      await reset();
      const userId = new mongoose.Types.ObjectId();
      await UserDetail.create({ userId, phone: '0901234567' });
      await Link.create({ userId, telegramUserId: '101', chatId: '101', phone: '0901234567' });
      const booking = await newBooking(userId, 'PENDING');
      const input = { refundPolicySnapshot: { source: 'legacy-v1', capturedAt: new Date() } };
      const first = await paidPolicy.transitionPendingBookingToPaid(booking, input);
      assert.equal(first.transitioned, true);
      assert.equal((await Booking.findById(booking._id)).status, 'PAID');
      assert.equal(await Pass.countDocuments({ bookingId: booking._id }), 1);
      assert.equal(await Delivery.countDocuments({ bookingId: booking._id }), 1);
      const repeated = await paidPolicy.transitionPendingBookingToPaid(first.booking, input);
      assert.equal(repeated.transitioned, false);
      const staleReplay = await paidPolicy.transitionPendingBookingToPaid(booking, input);
      assert.equal(staleReplay.transitioned, false);
      assert.equal(await Pass.countDocuments({ bookingId: booking._id }), 1);
      assert.equal(await Delivery.countDocuments({ bookingId: booking._id }), 1);
    });

    await t.test('outbox database failure rolls back PAID transition and newly created pass', async () => {
      await reset();
      const userId = new mongoose.Types.ObjectId();
      await UserDetail.create({ userId, phone: '0901234567' });
      await Link.create({ userId, telegramUserId: '101', chatId: '101', phone: '0901234567' });
      const booking = await newBooking(userId, 'PENDING');
      const originalEnqueue = Delivery.findOneAndUpdate;
      Delivery.findOneAndUpdate = () => { throw new Error('isolated outbox database failure'); };
      try {
        await assert.rejects(paidPolicy.transitionPendingBookingToPaid(booking, { refundPolicySnapshot: { source: 'legacy-v1', capturedAt: new Date() } }), /isolated outbox database failure/);
      } finally { Delivery.findOneAndUpdate = originalEnqueue; }
      assert.equal((await Booking.findById(booking._id)).status, 'PENDING');
      assert.equal(await Pass.countDocuments({ bookingId: booking._id }), 0);
      assert.equal(await Delivery.countDocuments({ bookingId: booking._id }), 0);
    });

    await t.test('20 contacts consuming one app token produce one active link and one explicit-booking delivery', async () => {
      await reset();
      const userId = new mongoose.Types.ObjectId();
      await UserDetail.create({ userId, phone: '0901234567' });
      const booking = await newBooking(userId);
      const result = await linkService.createLinkToken(userId, String(booking._id));
      const raw = tokenFrom(result);
      assert.equal(await claimService.bindStart(contact(), raw), true);
      assert.equal(await claimService.bindStart(contact(102), raw), false);
      const results = await Promise.allSettled(Array.from({ length: 20 }, () => claimService.consumeContact(contact())));
      assert.equal(results.filter(value => value.status === 'fulfilled' && value.value.ok).length, 1);
      assert.equal(await Link.countDocuments({ userId, revokedAt: null }), 1);
      assert.equal(await Delivery.countDocuments({ bookingId: booking._id }), 1);
      assert.equal(await Claim.countDocuments({ consumedAt: { $ne: null } }), 1);
      const delivery = await Delivery.findOne({ bookingId: booking._id });
      assert.equal(delivery.chatId, '101');
      // Booking was paid before linking; this explicitly requested ticket must still be deliverable.
      const state = await worker.processDelivery(delivery);
      assert.equal(state.status, 'sent'); assert.deepEqual(sent, ['101']);
    });

    await t.test('guest wrong or forwarded contact is denied; 20 matching contacts enqueue only its session', async () => {
      await reset();
      const parkingSession = await Session.create({ licensePlate: '51A22222', phone: '0901234567', type: 'WALK_IN', status: 'active' });
      const pass = await passService.ensureSessionPass(parkingSession);
      const result = await claimService.createGuestClaim({ sessionId: parkingSession._id, passId: pass._id });
      const raw = tokenFrom(result);
      await claimService.bindStart(contact(), raw);
      assert.equal((await claimService.consumeContact(contact(101, '+84909999999'))).ok, false);
      const forwarded = contact(); forwarded.contact.user_id = 202;
      assert.equal((await claimService.consumeContact(forwarded)).ok, false);
      assert.equal(await Delivery.countDocuments(), 0);
      const results = await Promise.allSettled(Array.from({ length: 20 }, () => claimService.consumeContact(contact())));
      assert.equal(results.filter(value => value.status === 'fulfilled' && value.value.ok).length, 1);
      assert.equal(await Delivery.countDocuments(), 1);
      assert.equal(await Link.countDocuments(), 0);
      const delivery = await Delivery.findOne();
      assert.equal(String(delivery.sessionId), String(parkingSession._id));
      assert.equal(delivery.passVersion, pass.qrVersion);
    });

    await t.test('two VALO accounts cannot bind the same active Telegram identity', async () => {
      await reset();
      const owners = [new mongoose.Types.ObjectId(), new mongoose.Types.ObjectId()];
      await UserDetail.create(owners.map(userId => ({ userId, phone: '0901234567' })));
      const first = await linkService.createLinkToken(owners[0]);
      await claimService.bindStart(contact(), tokenFrom(first));
      assert.equal((await claimService.consumeContact(contact())).ok, true);
      const second = await linkService.createLinkToken(owners[1]);
      await claimService.bindStart(contact(), tokenFrom(second));
      assert.equal((await claimService.consumeContact(contact())).ok, false);
      assert.equal(await Link.countDocuments({ revokedAt: null }), 1);
    });

    await t.test('duplicate webhook updates persist exactly one queue record before ACK', async () => {
      await reset();
      const requests = Array.from({ length: 20 }, () => new Promise((resolve, reject) => {
        const req = { get: () => 'isolated-webhook-secret', body: { update_id: 123, message: { ...contact(), text: '/start' } } };
        Promise.resolve(controller.webhook(req, { sendStatus: resolve })).catch(reject);
      }));
      const responses = await Promise.all(requests);
      assert.ok(responses.every(status => status === 200));
      assert.equal(await Update.countDocuments({ updateId: 123 }), 1);
    });

    await t.test('unlink cancels queued ticket, invalidates pending tokens and suppresses network send', async () => {
      await reset();
      const userId = new mongoose.Types.ObjectId(), booking = await newBooking(userId);
      await UserDetail.create({ userId, phone: '0901234567' });
      const result = await linkService.createLinkToken(userId, String(booking._id));
      await claimService.bindStart(contact(), tokenFrom(result));
      await claimService.consumeContact(contact());
      const pending = await linkService.createLinkToken(userId);
      const delivery = await Delivery.findOne();
      await linkService.unlink(userId);
      assert.equal(await claimService.bindStart(contact(), tokenFrom(pending)), false);
      assert.equal((await Delivery.findById(delivery._id)).status, 'cancelled');
      assert.equal((await worker.processDelivery(delivery)).status, 'cancelled');
      assert.equal(sent.length, 0);
      assert.equal((await linkService.getStatus(userId)).linked, false);
    });

    const account = async (phone = '0901234567') => {
      const userId = new mongoose.Types.ObjectId();
      await User.create({ _id: userId, username: `test_${String(userId).slice(-12)}`, email: `${userId}@example.test` });
      await UserDetail.create({ userId, phone });
      return userId;
    };
    const saveProfile = async (userId, body) => {
      let payload, status;
      const res = { status(value) { status = value; return this; }, json(value) { payload = value; return this; } };
      await profileController.updateProfile({ user: { _id: userId }, body }, res, error => { throw error; });
      assert.equal(status, 200, JSON.stringify(payload));
      return payload;
    };
    const activate = async (userId, bookingId) => {
      const token = await linkService.createLinkToken(userId, bookingId && String(bookingId));
      assert.equal(await claimService.bindStart(contact(), tokenFrom(token)), true);
      assert.equal((await claimService.consumeContact(contact())).ok, true);
      return Link.findOne({ userId }).select('+phone');
    };

    await t.test('account token requires valid saved phone without revoking pending claims on invalid request', async () => {
      await reset();
      const userId = await account('');
      const pending = await Claim.create({ purpose: 'link', userId, tokenHash: 'retained', recipientPhone: '0901234567', expiresAt: new Date(Date.now() + 60000) });
      for (const phone of ['', '123']) {
        await UserDetail.updateOne({ userId }, { $set: { phone } });
        await assert.rejects(linkService.createLinkToken(userId), error => error.code === 'PROFILE_PHONE_REQUIRED' && error.statusCode === 400);
      }
      assert.equal((await Claim.findById(pending._id)).revokedAt, null);
      const status = await linkService.getStatus(userId);
      assert.equal(status.needsPhone, true); assert.equal(status.linked, false); assert.equal(status.available, true);
    });

    await t.test('snapshot rejects wrong or forwarded contact then accepts normalized own contact without history', async () => {
      await reset();
      const userId = await account('+84 901 234 567');
      const token = await linkService.createLinkToken(userId);
      const stored = await Claim.findOne({ userId }).select('+recipientPhone');
      assert.equal(stored.recipientPhone, '0901234567');
      await claimService.bindStart(contact(), tokenFrom(token));
      assert.equal((await claimService.consumeContact(contact(101, '+84909999999'))).ok, false);
      const forwarded = contact(); forwarded.contact.user_id = 202;
      assert.equal((await claimService.consumeContact(forwarded)).ok, false);
      assert.equal(await Link.countDocuments(), 0);
      assert.equal((await Claim.findById(stored._id)).consumedAt, null);
      assert.equal((await claimService.consumeContact(contact())).ok, true);
      assert.equal((await linkService.getStatus(userId)).phoneMatches, true);
      assert.equal(await Delivery.countDocuments(), 0);
    });

    await t.test('legacy tokens missing snapshot and token with changed current phone cannot link', async () => {
      await reset();
      const userId = await account();
      const legacy = await claimService.createToken({ purpose: 'link', userId });
      await claimService.bindStart(contact(), tokenFrom(legacy));
      assert.equal((await claimService.consumeContact(contact())).ok, false);
      const token = await linkService.createLinkToken(userId);
      await claimService.bindStart(contact(), tokenFrom(token));
      await UserDetail.updateOne({ userId }, { $set: { phone: '0909999999' } });
      assert.equal((await claimService.consumeContact(contact())).ok, false);
      assert.equal(await Link.countDocuments(), 0);
    });

    await t.test('name-only update and equivalent phone format preserve linked phone, token and queued ticket', async () => {
      await reset();
      const userId = await account(), booking = await newBooking(userId);
      const link = await activate(userId, booking._id);
      const token = await linkService.createLinkToken(userId);
      await saveProfile(userId, { firstName: 'Updated', avatar: 'https://example.test/avatar.png' });
      assert.equal((await UserDetail.findOne({ userId })).phone, '0901234567');
      await saveProfile(userId, { phone: '+84 901 234 567' });
      assert.equal((await Link.findById(link._id)).revokedAt, null);
      assert.equal((await Delivery.findOne({ bookingId: booking._id })).status, 'pending');
      assert.equal(await claimService.bindStart(contact(), tokenFrom(token)), true);
    });

    await t.test('phone change cancels all unsent jobs, clears leases and prevents A-B-A token resurrection', async () => {
      await reset();
      const userId = await account(), booking = await newBooking(userId);
      const link = await activate(userId, booking._id);
      const pending = await linkService.createLinkToken(userId);
      const template = await Delivery.findOne({ bookingId: booking._id }).lean();
      for (const state of ['processing', 'uncertain']) {
        const { _id, createdAt, updatedAt, ...copy } = template;
        await Delivery.create({ ...copy, dedupeKey: state, status: state, leaseId: 'old-lease', leaseUntil: new Date(Date.now() + 60000) });
      }
      await saveProfile(userId, { phone: '0909999999' });
      assert.ok((await Link.findById(link._id)).revokedAt);
      assert.equal(await Delivery.countDocuments({ status: 'cancelled', errorCode: 'PROFILE_PHONE_CHANGED' }), 3);
      assert.equal(await Delivery.countDocuments({ leaseId: { $exists: true } }), 0);
      await saveProfile(userId, { phone: '0901234567' });
      assert.equal(await claimService.bindStart(contact(), tokenFrom(pending)), false);
      await activate(userId);
      await saveProfile(userId, { phone: '' });
      assert.equal((await linkService.getStatus(userId)).needsPhone, true);
      assert.equal((await linkService.getStatus(userId)).linked, false);
      assert.equal((await receiptService.bookingStatus(String(booking._id), userId)).state, 'needs_phone');
    });

    await t.test('concurrent profile change and contact cannot leave old-phone account link active', async () => {
      await reset();
      const userId = await account();
      const token = await linkService.createLinkToken(userId);
      await claimService.bindStart(contact(), tokenFrom(token));
      await Promise.all([claimService.consumeContact(contact()), saveProfile(userId, { phone: '0909999999' })]);
      assert.equal((await UserDetail.findOne({ userId })).phone, '0909999999');
      assert.equal(await Link.countDocuments({ userId, revokedAt: null }), 0);
      assert.equal((await linkService.getStatus(userId)).linked, false);
    });

    await t.test('matching legacy link sends repeat paid bookings once; preference off suppresses queueing', async () => {
      await reset();
      const userId = await account();
      await Link.create({ userId, telegramUserId: '101', chatId: '101', phone: '+84901234567' });
      const booking = await newBooking(userId);
      await deliveryService.enqueueBookingTicket(booking); await deliveryService.enqueueBookingTicket(booking);
      assert.equal(await Delivery.countDocuments({ bookingId: booking._id }), 1);
      assert.equal((await worker.processDelivery(await Delivery.findOne())).status, 'sent');
      assert.equal((await linkService.preferences(userId, false)).notificationsEnabled, false);
      await deliveryService.enqueueBookingTicket(await newBooking(userId));
      assert.equal(await Delivery.countDocuments(), 1);
      assert.equal((await linkService.preferences(userId, true)).notificationsEnabled, true);
    });

    await t.test('repeat booking requests reuse pending or sent receipt across Telegram relinking', async () => {
      await reset();
      const userId = await account(), booking = await newBooking(userId);
      await activate(userId, booking._id);
      const original = await Delivery.findOne({ bookingId: booking._id });
      const claims = await Claim.countDocuments();
      const requests = await Promise.all(Array.from({ length: 12 }, () => linkService.createLinkToken(userId, String(booking._id))));
      assert.ok(requests.every(result => result.state === 'pending' && !result.deepLink));
      assert.equal(await Claim.countDocuments(), claims);
      assert.equal(await Delivery.countDocuments({ bookingId: booking._id }), 1);
      await Delivery.updateOne({ _id: original._id }, { $set: { status: 'sent', sentAt: new Date(), messageId: 123 } });
      await linkService.unlink(userId);
      await activate(userId);
      const reused = await deliveryService.enqueueBookingTicket(booking);
      assert.equal(String(reused._id), String(original._id));
      assert.equal((await linkService.createLinkToken(userId, String(booking._id))).state, 'sent');
      assert.equal((await receiptService.bookingStatus(String(booking._id), userId)).state, 'sent');
      assert.equal(await Delivery.countDocuments({ bookingId: booking._id }), 1);
      const another = await newBooking(userId);
      await deliveryService.enqueueBookingTicket(another);
      assert.equal(await Delivery.countDocuments({ bookingId: another._id }), 1);
    });

    await t.test('mismatched legacy link is rejected by status, preferences, enqueue and worker', async () => {
      await reset();
      const userId = await account();
      const link = await Link.create({ userId, telegramUserId: '101', chatId: '101', phone: '0909999999' });
      const booking = await newBooking(userId);
      const status = await linkService.getStatus(userId);
      assert.equal(status.linked, false); assert.equal(status.phoneMatches, false);
      await assert.rejects(linkService.preferences(userId, true), error => error.code === 'TELEGRAM_RELINK_REQUIRED');
      assert.equal(await deliveryService.enqueueBookingTicket(booking), null);
      assert.equal((await worker.processDelivery({ linkId: link._id, chatId: '101', telegramUserId: '101' })).status, 'cancelled');
      assert.equal((await receiptService.bookingStatus(String(booking._id), userId)).state, 'needs_link');
      assert.equal(sent.length, 0);
    });

    await t.test('profile change while rendering QR is caught by final send guard', async () => {
      await reset();
      const userId = await account(), booking = await newBooking(userId);
      await activate(userId, booking._id);
      const qr = require('qrcode'), originalBuffer = qr.toBuffer;
      qr.toBuffer = async (...args) => {
        const png = await originalBuffer(...args);
        await saveProfile(userId, { phone: '0909999999' });
        return png;
      };
      try {
        const state = await worker.processDelivery(await Delivery.findOne({ bookingId: booking._id }));
        assert.equal(state.status, 'cancelled'); assert.equal(sent.length, 0);
      } finally { qr.toBuffer = originalBuffer; }
    });

    await t.test('expired worker lease is recovered after restart and only its owner can finalize', async () => {
      await reset();
      const parkingSession = await Session.create({ licensePlate: '51A33333', type: 'WALK_IN', status: 'active' });
      const pass = await passService.ensureSessionPass(parkingSession);
      const delivery = await Delivery.create({ dedupeKey: 'restart-test', kind: 'guest_ticket', sessionId: parkingSession._id, passId: pass._id, passVersion: pass.qrVersion, chatId: '101', telegramUserId: '101' });
      const first = await worker.acquireLease(Delivery, ['pending']);
      await Delivery.updateOne({ _id: delivery._id }, { $set: { leaseUntil: new Date(Date.now() - 1000) } });
      const recovered = await worker.acquireLease(Delivery, ['pending']);
      assert.notEqual(recovered.leaseId, first.leaseId);
      const staleFinish = await worker.finish(Delivery, first, { status: 'sent' });
      assert.equal(staleFinish.modifiedCount, 0);
      await worker.finish(Delivery, recovered, await worker.processDelivery(recovered));
      assert.equal((await Delivery.findById(delivery._id)).status, 'sent'); assert.deepEqual(sent, ['101']);
    });
  } finally {
    client.sendPhoto = originalPhoto; client.sendMessage = originalMessage;
    await mongoose.disconnect(); await replica.stop();
  }
});
