const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
Object.assign(process.env, { TELEGRAM_ENABLED: 'true', TELEGRAM_BOT_TOKEN: 'isolated-never-sent',
  SUBSCRIPTION_RENEWAL_ENABLED: 'true', CLIENT_URL: 'https://valo.example.test' });
const User = require('../models/User');
const Profile = require('../models/UserDetail');
const Link = require('../models/TelegramLink');
const Delivery = require('../models/TelegramDelivery');
const Update = require('../models/TelegramUpdate');
const Subscription = require('../models/Subscription');
const Entitlement = require('../models/MembershipSlotEntitlement');
const Package = require('../models/TicketPackage');
const reminders = require('../services/telegramMembershipReminderService');
const worker = require('../services/telegramWorker');
const client = require('../services/telegramClient');
const DAY = 86400000;
const models = [User, Profile, Link, Delivery, Update, Subscription, Entitlement, Package];

test('membership Telegram reminders use isolated DB and stubbed Telegram', { timeout: 180000 }, async t => {
  const replica = await MongoMemoryReplSet.create({ binary: { downloadDir: path.resolve(__dirname, '../../../.mongodb-binaries') }, replSet: { count: 1 } });
  const originalSend = client.sendMessage;
  let sent = [];
  const send = async (chatId, text, markup, options) => { sent.push({ chatId, text, markup, options }); return { message_id: sent.length }; };
  client.sendMessage = send;
  try {
    await mongoose.connect(replica.getUri(), { dbName: 'membership_telegram_isolated' });
    await Promise.all(models.map(model => model.init()));
    const reset = async () => { await Promise.all(models.map(model => model.deleteMany({}))); sent = []; client.sendMessage = send; };
    const account = async (chat = '101') => {
      const id = new mongoose.Types.ObjectId();
      await User.create({ _id: id, username: `u${chat}`, email: `${id}@example.test`, role: 'customer', status: true });
      await Profile.create({ userId: id, phone: '0901234567' });
      await Link.create({ userId: id, telegramUserId: chat, chatId: chat, phone: '+84901234567' });
      return id;
    };
    const pkg = () => Package.create({ name: 'VIP tháng', type: 'monthly', price: 300000 });
    const subscription = (user, ticketPackage, expireAt, extra = {}) => Subscription.create({ user, ticketPackage,
      amount: 300000, orderCode: Date.now(), validFrom: new Date(Date.now() - 30 * DAY), expireAt,
      paymentStatus: 'paid', status: 'active', slots: [{ floorId: new mongoose.Types.ObjectId(), slotCode: 'A1' }], ...extra });
    const entitlement = (sub, ownerId, slotCode = 'A1', extra = {}) => Entitlement.create({ ownerId,
      sourceSubscriptionId: sub._id, slotId: new mongoose.Types.ObjectId(), floorId: new mongoose.Types.ObjectId(),
      slotCode, packageId: sub.ticketPackage, validFrom: sub.validFrom, expireAt: sub.expireAt,
      status: 'active', unitAmount: 300000, ...extra });

    await t.test('7-day boundary excludes later, expired, unpaid and cancelled subscriptions', async () => {
      await reset();
      const user = await account(), p = await pkg(), now = new Date();
      const eligible = await subscription(user, p._id, new Date(now.getTime() + 7 * DAY));
      await subscription(user, p._id, new Date(now.getTime() + 7 * DAY + 1));
      await subscription(user, p._id, now);
      await subscription(user, p._id, new Date(now.getTime() + DAY), { paymentStatus: 'pending' });
      await subscription(user, p._id, new Date(now.getTime() + DAY), { status: 'cancelled' });
      await reminders.reconcile(now);
      assert.equal(await Delivery.countDocuments(), 1);
      assert.equal(String((await Delivery.findOne()).subscriptionId), String(eligible._id));
    });
    await t.test('concurrent scans create one reminder and worker sends one renewal button', async () => {
      await reset();
      const user = await account(), p = await pkg();
      const sub = await subscription(user, p._id, new Date(Date.now() + 6 * DAY));
      await Promise.all(Array.from({ length: 6 }, () => reminders.reconcile()));
      assert.equal(await Delivery.countDocuments(), 1);
      await worker.runTelegramWorkerOnce(); await worker.runTelegramWorkerOnce(); await reminders.reconcile();
      assert.equal(sent.length, 1);
      assert.ok(sent[0].text.includes('<b>VIP tháng</b>')); assert.ok(sent[0].text.includes('<b>6 ngày</b>'));
      assert.equal(sent[0].options.parseMode, 'HTML');
      const button = sent[0].markup.inline_keyboard[0][0];
      assert.equal(button.text, 'Gia hạn gói');
      assert.equal(new URL(button.url).searchParams.get('renewSubscriptionId'), String(sub._id));
      assert.equal(new URL(button.url).origin, 'https://valo.example.test');
      assert.equal((await Delivery.findOne()).status, 'sent');
    });
    await t.test('entitlements group by current owner and expiry, never remind original transferred owner', async () => {
      await reset();
      const original = await account('101'), buyer = await account('202'), p = await pkg();
      const sub = await subscription(original, p._id, new Date(Date.now() + 6 * DAY));
      const a = await entitlement(sub, buyer, 'B1'); await entitlement(sub, buyer, 'B2');
      await reminders.reconcile();
      assert.equal(await Delivery.countDocuments(), 1);
      await worker.runTelegramWorkerOnce();
      assert.equal(sent[0].chatId, '202');
      assert.ok(sent[0].text.includes('B1, B2'));
      assert.equal(new URL(sent[0].markup.inline_keyboard[0][0].url).searchParams.get('renewEntitlementId'), String(a._id));
      assert.equal(sent[0].markup.inline_keyboard.length, 2);
      assert.equal(sent[0].markup.inline_keyboard[1][0].text, 'Gia hạn ô B2');
    });
    await t.test('renewal invalidates queued expiry and creates a new reminder only for the new period', async () => {
      await reset();
      const user = await account(), p = await pkg();
      const sub = await subscription(user, p._id, new Date(Date.now() + DAY));
      await reminders.reconcile();
      const extended = new Date(Date.now() + 31 * DAY);
      await Subscription.updateOne({ _id: sub._id }, { $set: { expireAt: extended } });
      await worker.runTelegramWorkerOnce();
      assert.equal(sent.length, 0); assert.equal((await Delivery.findOne()).status, 'cancelled');
      await reminders.reconcile(new Date(extended.getTime() - 6 * DAY));
      assert.equal(await Delivery.countDocuments(), 2);
    });
    await t.test('send rechecks changed entitlement ownership and current profile phone', async () => {
      await reset();
      const user = await account(), buyer = await account('202'), p = await pkg();
      const sub = await subscription(user, p._id, new Date(Date.now() + 6 * DAY));
      const space = await entitlement(sub, user);
      await reminders.reconcile();
      await Entitlement.updateOne({ _id: space._id }, { $set: { ownerId: buyer } });
      await worker.runTelegramWorkerOnce(); assert.equal(sent.length, 0);
      await reminders.reconcile();
      await Profile.updateOne({ userId: buyer }, { $set: { phone: '0909999999' } });
      await worker.runTelegramWorkerOnce(); assert.equal(sent.length, 0);
      assert.equal(await Delivery.countDocuments({ status: 'cancelled' }), 2);
    });
    await t.test('disabled preferences, blocked bot, missing link, inactive user and nonrenewable package do not queue', async () => {
      await reset();
      const user = await account(), p = await pkg();
      await subscription(user, p._id, new Date(Date.now() + DAY));
      for (const changes of [{ notificationsEnabled: false }, { notificationsEnabled: true, blockedAt: new Date() }]) {
        await Link.updateOne({ userId: user }, { $set: changes }); await reminders.reconcile();
        assert.equal(await Delivery.countDocuments(), 0);
      }
      await Link.updateOne({ userId: user }, { $set: { blockedAt: null } });
      await User.updateOne({ _id: user }, { $set: { status: false } }); await reminders.reconcile();
      assert.equal(await Delivery.countDocuments(), 0);
      await User.updateOne({ _id: user }, { $set: { status: true } });
      await Package.updateOne({ _id: p._id }, { $set: { isRenewable: false } }); await reminders.reconcile();
      assert.equal(await Delivery.countDocuments(), 0);
      await Package.updateOne({ _id: p._id }, { $set: { isRenewable: true } });
      await Link.deleteMany({}); await reminders.reconcile(); assert.equal(await Delivery.countDocuments(), 0);
    });
    await t.test('timeout and expired send lease become uncertain and are never automatically resent', async () => {
      await reset();
      const user = await account(), p = await pkg();
      await subscription(user, p._id, new Date(Date.now() + DAY)); await reminders.reconcile();
      let calls = 0;
      client.sendMessage = async () => { calls++; throw Object.assign(new Error('isolated timeout'), { code: 'ECONNABORTED' }); };
      await worker.runTelegramWorkerOnce();
      assert.equal((await Delivery.findOne()).status, 'uncertain');
      await Delivery.updateMany({}, { $set: { nextAttemptAt: new Date(0) } });
      await reminders.reconcile(); await worker.runTelegramWorkerOnce(); assert.equal(calls, 1);
      await Delivery.updateMany({}, { $set: { status: 'processing', leaseUntil: new Date(0), leaseId: 'expired' } });
      await worker.runTelegramWorkerOnce(); assert.equal(calls, 1);
      assert.equal((await Delivery.findOne()).status, 'uncertain');
    });
    await t.test('unlink and relink cannot replay a previously uncertain reminder', async () => {
      await reset();
      const user = await account(), p = await pkg();
      await subscription(user, p._id, new Date(Date.now() + DAY)); await reminders.reconcile();
      await Delivery.updateMany({}, { $set: { status: 'uncertain', attempts: 1 } });
      await require('../services/telegramLinkService').unlink(user);
      await Link.updateOne({ userId: user }, { $set: { revokedAt: null, notificationsEnabled: true, linkedAt: new Date() } });
      await reminders.reconcile(); await worker.runTelegramWorkerOnce();
      assert.equal(sent.length, 0); assert.equal((await Delivery.findOne()).status, 'cancelled');
    });
    await t.test('final expiry check cancels a renewal occurring while the recipient is being loaded', async () => {
      await reset();
      const user = await account(), p = await pkg();
      const sub = await subscription(user, p._id, new Date(Date.now() + DAY)); await reminders.reconcile();
      const profile = require('../services/telegramProfileService'), original = profile.matchesProfile;
      let changed = false;
      profile.matchesProfile = async (...args) => {
        const matches = await original(...args);
        if (!changed) { changed = true; await Subscription.updateOne({ _id: sub._id }, { $set: { expireAt: new Date(Date.now() + 31 * DAY) } }); }
        return matches;
      };
      try { await worker.runTelegramWorkerOnce(); } finally { profile.matchesProfile = original; }
      assert.equal(sent.length, 0); assert.equal((await Delivery.findOne()).status, 'cancelled');
    });
    await t.test('disabled renewal feature never queues; unavailable URL still sends a text-only reminder', async () => {
      await reset();
      const user = await account(), p = await pkg();
      await subscription(user, p._id, new Date(Date.now() + DAY));
      process.env.SUBSCRIPTION_RENEWAL_ENABLED = 'false';
      try { await reminders.reconcile(); assert.equal(await Delivery.countDocuments(), 0); }
      finally { process.env.SUBSCRIPTION_RENEWAL_ENABLED = 'true'; }
      const previous = process.env.CLIENT_URL; process.env.CLIENT_URL = 'javascript:alert(1)';
      try {
        await reminders.reconcile(); assert.equal(await Delivery.countDocuments(), 1);
        await worker.runTelegramWorkerOnce();
        assert.equal(sent.length, 1); assert.equal(sent[0].markup, undefined);
        assert.ok(!sent[0].text.includes('Bấm nút'));
      }
      finally { process.env.CLIENT_URL = previous; }
    });
    await t.test('localhost URL never becomes an inline button and does not block reminders', async () => {
      await reset();
      const user = await account(), p = await pkg();
      await subscription(user, p._id, new Date(Date.now() + DAY));
      const previous = process.env.CLIENT_URL; process.env.CLIENT_URL = 'http://localhost:5173';
      try {
        await reminders.reconcile(); await worker.runTelegramWorkerOnce();
        assert.equal(sent.length, 1); assert.equal(sent[0].markup, undefined);
        assert.ok(sent[0].text.includes('Nhắc gia hạn'));
        assert.ok(!sent[0].text.includes('bên dưới'));
        assert.equal((await Delivery.findOne()).status, 'sent');
      } finally { process.env.CLIENT_URL = previous; }
    });
  } finally { client.sendMessage = originalSend; await mongoose.disconnect(); await replica.stop(); }
});
