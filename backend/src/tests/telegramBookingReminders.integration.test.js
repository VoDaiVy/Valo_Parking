const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
Object.assign(process.env, { TELEGRAM_ENABLED: 'true', TELEGRAM_BOT_TOKEN: 'isolated-never-sent',
  TELEGRAM_BOT_USERNAME: 'valo_test_bot', PARKING_PASS_QR_SECRET: 'isolated-qr-secret', PARKING_PASS_ISSUE_ENABLED: 'true' });
const User = require('../models/User');
const Profile = require('../models/UserDetail');
const Link = require('../models/TelegramLink');
const Delivery = require('../models/TelegramDelivery');
const Update = require('../models/TelegramUpdate');
const Claim = require('../models/TelegramClaimToken');
const Booking = require('../models/Booking');
const Session = require('../models/Session');
const Pass = require('../models/ParkingPass');
const Floor = require('../models/ParkingFloor');
const reminders = require('../services/telegramBookingReminderService');
const worker = require('../services/telegramWorker');
const client = require('../services/telegramClient');
const MINUTE = 60000;
const models = [User, Profile, Link, Delivery, Update, Claim, Booking, Session, Pass, Floor];

test('early warning is at start +15, before QR deadline start +30', () => {
  const start = new Date('2026-11-03T07:00:00Z');
  const booking = { status: 'PAID', scheduledStart: start, scheduledEnd: new Date('2026-11-03T08:00:00Z') };
  for (const [minutes, expected] of [[-15, false], [0, false], [14.99, false], [15, true], [20, true], [29.99, true], [30, false], [35, false]]) {
    assert.equal(reminders.shouldRemind(booking, new Date(start.getTime() + minutes * MINUTE)), expected);
  }
  assert.equal(reminders.checkinDeadline(booking).toISOString(), '2026-11-03T07:30:00.000Z');
  const text = reminders.formatReminder({ ...booking, licensePlate: '<PLATE>', floorId: { name: 'Tầng & 2' }, parkingSlot: 'E9' }, new Date('2026-11-03T07:15:00Z'));
  assert.ok(text.includes('<b>15 phút</b>'));
  assert.ok(text.includes('03/11/2026 · 14:30'));
  assert.ok(text.includes('&lt;PLATE&gt;')); assert.ok(text.includes('Tầng &amp; 2'));
  assert.ok(text.includes('mã QR không còn hiệu lực để vào bãi'));
});

test('booking early Telegram warnings on isolated Mongo with stubbed Telegram', { timeout: 180000 }, async t => {
  const replica = await MongoMemoryReplSet.create({ binary: { downloadDir: path.resolve(__dirname, '../../../.mongodb-binaries') }, replSet: { count: 1 } });
  const originalSend = client.sendMessage;
  let sent = [];
  const send = async (chatId, text, markup, options) => { sent.push({ chatId, text, markup, options }); return { message_id: sent.length }; };
  client.sendMessage = send;
  try {
    await mongoose.connect(replica.getUri(), { dbName: 'booking_reminders_isolated' });
    await Promise.all(models.map(model => model.init()));
    const reset = async () => { await Promise.all(models.map(model => model.deleteMany({}))); sent = []; client.sendMessage = send; };
    const setup = async (extra = {}) => {
      const user = await User.create({ username: 'early_warning', email: 'early@example.test', role: 'customer', status: true });
      await Profile.create({ userId: user._id, phone: '0901234567' });
      await Link.create({ userId: user._id, chatId: '101', telegramUserId: '101', phone: '+84901234567' });
      const floor = await Floor.create({ name: 'Tầng 2', floorNumber: 2 });
      const now = new Date();
      const booking = await Booking.create({ userId: user._id, floorId: floor._id, licensePlate: '43AB12345', parkingSlot: 'E9',
        scheduledStart: new Date(now.getTime() - 20 * MINUTE), scheduledEnd: new Date(now.getTime() + 40 * MINUTE),
        durationHours: 1, paymentMethod: 'wallet', status: 'EXPIRED', paidAt: new Date(now.getTime() - 60 * MINUTE), ...extra });
      return { booking, user, now };
    };
    await t.test('concurrent scans create one text notification and a sent reminder is not repeated', async () => {
      await reset(); await setup();
      await Promise.all(Array.from({ length: 6 }, () => reminders.reconcile()));
      assert.equal(await Delivery.countDocuments(), 1);
      await worker.runTelegramWorkerOnce(); await worker.runTelegramWorkerOnce(); await reminders.reconcile();
      assert.equal(sent.length, 1); assert.equal(sent[0].chatId, '101');
      assert.ok(sent[0].text.includes('Cảnh báo trễ check-in')); assert.ok(sent[0].text.includes('10 phút'));
      assert.equal(sent[0].options.parseMode, 'HTML'); assert.equal(sent[0].markup, undefined);
      assert.equal((await Delivery.findOne()).status, 'sent');
    });
    await t.test('before warning or after deadline, inactive states and previously checked-in customers never queue', async () => {
      for (const status of ['PENDING', 'ACTIVE', 'PAUSED', 'CANCELLED', 'COMPLETED']) {
        await reset(); await setup({ status }); await reminders.reconcile(); assert.equal(await Delivery.countDocuments(), 0);
      }
      await reset(); const { booking, now } = await setup();
      await reminders.reconcile(new Date(new Date(booking.scheduledStart).getTime() + 14 * MINUTE));
      await reminders.reconcile(new Date(new Date(booking.scheduledStart).getTime() + 30 * MINUTE));
      assert.equal(await Delivery.countDocuments(), 0);
      await Session.create({ bookingId: booking._id, licensePlate: booking.licensePlate, type: 'BOOKING', status: 'completed' });
      await reminders.reconcile(now); assert.equal(await Delivery.countDocuments(), 0);
    });
    await t.test('check-in after enqueue suppresses pending warning', async () => {
      await reset(); const { booking } = await setup(); await reminders.reconcile();
      await Booking.updateOne({ _id: booking._id }, { $set: { status: 'ACTIVE' } });
      await worker.runTelegramWorkerOnce(); assert.equal(sent.length, 0);
      assert.equal((await Delivery.findOne()).status, 'cancelled');
    });
    await t.test('cancel, reschedule or expired QR window suppress old jobs', async () => {
      for (const changes of [{ status: 'CANCELLED' }, { scheduledStart: new Date(Date.now() + 60 * MINUTE) },
        { scheduledStart: new Date(Date.now() - 31 * MINUTE) }, { scheduledEnd: new Date(Date.now() - MINUTE) }]) {
        await reset(); const { booking } = await setup(); await reminders.reconcile();
        await Booking.updateOne({ _id: booking._id }, { $set: changes });
        await worker.runTelegramWorkerOnce(); assert.equal(sent.length, 0);
        assert.equal((await Delivery.findOne()).status, 'cancelled');
      }
    });
    await t.test('opt-out, blocked/unlinked bot, phone mismatch or inactive user do not enqueue', async () => {
      for (const state of ['off', 'blocked', 'unlinked', 'phone', 'inactive']) {
        await reset(); const { user } = await setup();
        if (state === 'off') await Link.updateOne({}, { $set: { notificationsEnabled: false } });
        if (state === 'blocked') await Link.updateOne({}, { $set: { blockedAt: new Date() } });
        if (state === 'unlinked') await Link.deleteMany({});
        if (state === 'phone') await Profile.updateOne({}, { $set: { phone: '0909999999' } });
        if (state === 'inactive') await User.updateOne({ _id: user._id }, { $set: { status: false } });
        await reminders.reconcile(); assert.equal(await Delivery.countDocuments(), 0);
      }
    });
    await t.test('last recipient check observes concurrent check-in', async () => {
      await reset(); const { booking } = await setup(); await reminders.reconcile();
      const profile = require('../services/telegramProfileService'), original = profile.matchesProfile;
      let checkedIn = false;
      profile.matchesProfile = async (...args) => {
        const match = await original(...args);
        if (!checkedIn) { checkedIn = true; await Booking.updateOne({ _id: booking._id }, { $set: { status: 'ACTIVE' } }); }
        return match;
      };
      try { await worker.runTelegramWorkerOnce(); } finally { profile.matchesProfile = original; }
      assert.equal(sent.length, 0); assert.equal((await Delivery.findOne()).status, 'cancelled');
    });
    await t.test('check-in during the final phone check also suppresses the warning', async () => {
      await reset(); const { booking } = await setup(); await reminders.reconcile();
      const profile = require('../services/telegramProfileService'), original = profile.matchesProfile;
      let checks = 0;
      profile.matchesProfile = async (...args) => {
        const match = await original(...args);
        if (++checks === 2) await Booking.updateOne({ _id: booking._id }, { $set: { status: 'ACTIVE' } });
        return match;
      };
      try { await worker.runTelegramWorkerOnce(); } finally { profile.matchesProfile = original; }
      assert.equal(sent.length, 0); assert.equal((await Delivery.findOne()).status, 'cancelled');
    });
    await t.test('a reminder cannot substitute for the booking QR receipt or block its account link', async () => {
      await reset(); const { booking, user } = await setup({ status: 'PAID' }); await reminders.reconcile();
      const receipt = require('../services/telegramReceiptService'), tickets = require('../services/telegramDeliveryService');
      assert.equal((await receipt.bookingStatus(String(booking._id), user._id)).state, 'needs_link');
      assert.ok((await require('../services/telegramLinkService').createLinkToken(user._id, String(booking._id))).deepLink);
      const ticket = await tickets.enqueueBookingTicket(booking);
      assert.equal(ticket.kind, 'booking_paid');
      assert.equal(await Delivery.countDocuments({ bookingId: booking._id }), 2);
    });
    await t.test('timeout and expired lease are uncertain, including after unlink/relink', async () => {
      await reset(); const { user } = await setup(); await reminders.reconcile();
      let attempts = 0;
      client.sendMessage = async () => { attempts++; throw Object.assign(new Error('isolated timeout'), { code: 'ECONNABORTED' }); };
      await worker.runTelegramWorkerOnce();
      assert.equal((await Delivery.findOne()).status, 'uncertain');
      await Delivery.updateMany({}, { $set: { nextAttemptAt: new Date(0) } });
      await reminders.reconcile(); await worker.runTelegramWorkerOnce(); assert.equal(attempts, 1);
      await Delivery.updateMany({}, { $set: { status: 'processing', leaseId: 'expired', leaseUntil: new Date(0) } });
      await worker.runTelegramWorkerOnce(); assert.equal((await Delivery.findOne()).status, 'uncertain');
      await require('../services/telegramLinkService').unlink(user._id);
      await Link.updateOne({}, { $set: { revokedAt: null, notificationsEnabled: true, linkedAt: new Date() } });
      await reminders.reconcile(); await worker.runTelegramWorkerOnce(); assert.equal(attempts, 1);
    });
  } finally { client.sendMessage = originalSend; await mongoose.disconnect(); await replica.stop(); }
});
