const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const User = require('../models/User');
const Detail = require('../models/UserDetail');
const Link = require('../models/TelegramLink');
const Voucher = require('../models/UserVoucher');
const Template = require('../models/VoucherTemplate');
const Distribution = require('../models/VoucherDistribution');
const Notification = require('../models/Notification');
const EmailJob = require('../models/RewardEmailJob');
const Delivery = require('../models/TelegramEventDelivery');
const live = require('../services/rewardNotificationDelivery');
const client = require('../services/telegramClient');
const { distribute } = require('../services/voucherDistributionService');
const telegram = require('../services/telegramEventNotificationService');

let repl, user, admin, template, published, sends;
const env = { ...process.env };
const originalPublish = live.publishNotifications;
const originalSend = client.sendMessage;

before(async () => {
  repl = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(repl.getUri('telegram_voucher_distribution_test'));
  assert.equal(mongoose.connection.host, '127.0.0.1');
  await Promise.all(Object.values(mongoose.models).map(Model => Model.init()));
});

beforeEach(async () => {
  for (const Model of Object.values(mongoose.models)) await Model.deleteMany({});
  process.env.TELEGRAM_ENABLED = 'true';
  process.env.TELEGRAM_VOUCHER_RECEIVED_ENABLED = 'true';
  process.env.TELEGRAM_EVENTS_FROM = new Date(Date.now() - 3600000).toISOString();
  process.env.TELEGRAM_WEB_APP_URL = 'https://parking.example.com';
  user = await User.create({ username: 'voucherrecipient', email: 'recipient@example.com', role: 'customer', status: true });
  admin = await User.create({ username: 'voucheradmin', email: 'admin@example.com', role: 'admin', status: true });
  await Detail.create({ userId: user._id, phone: '0901234567' });
  await Link.create({ userId: user._id, telegramUserId: '12345', chatId: '12345', phone: '0901234567', linkedAt: new Date(Date.now() - 60000) });
  template = await Template.create({ name: 'Admin gift', type: 'FIXED_DISCOUNT', discountAmount: 10000, minimumAmount: 50000 });
  published = [];
  sends = [];
  live.publishNotifications = (app, notifications) => published.push(...notifications);
  client.sendMessage = async (...args) => { sends.push(args); return { message_id: 123 }; };
});

after(async () => {
  live.publishNotifications = originalPublish;
  client.sendMessage = originalSend;
  for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key];
  Object.assign(process.env, env);
  await mongoose.disconnect();
  if (repl) await repl.stop();
});

function input(overrides = {}) {
  return { templateId: template._id, userIds: [user._id], requestId: randomUUID(), createdBy: admin._id, ...overrides };
}

test('admin distribution commits a Telegram event alongside the voucher and publishes its live notification', async () => {
  await distribute(input());
  const voucher = await Voucher.findOne({ source: 'manual' });
  assert.ok(voucher.telegramNotification?.occurredAt, 'actual admin distribution must persist the outbox marker');
  assert.equal(published.length, 1);
  assert.equal(published[0].metadata.voucherId, String(voucher._id));
  assert.equal(await EmailJob.countDocuments({ voucherId: voucher._id }), 1);
  await telegram.reconcile();
  const job = await Delivery.findOne({ voucherId: voucher._id });
  assert.ok(job);
  assert.equal(job.kind, 'voucher_received');
  assert.equal(String(job.eventUserId), String(user._id));
  job.status = 'processing';
  job.leaseId = 'distribution-test';
  job.leaseUntil = new Date(Date.now() + 60000);
  await job.save();
  assert.equal((await telegram.processDelivery(job)).status, 'sent');
  assert.equal(sends.length, 1);
  assert.match(sends[0][1], /Admin gift/);
});

test('replaying the same admin request creates one voucher and one Telegram delivery', async () => {
  const request = input();
  await distribute(request);
  await telegram.reconcile();
  await distribute(request);
  await telegram.reconcile();
  assert.equal(await Voucher.countDocuments(), 1);
  assert.equal(await Distribution.countDocuments(), 1);
  assert.equal(await Delivery.countDocuments({ kind: 'voucher_received' }), 1);
  assert.equal((await Template.findById(template._id)).redeemedCount, 1);
  assert.equal(published.length, 1);
});

test('failure after voucher creation rolls back the voucher, outbox event and live notification', async () => {
  const originalCreate = EmailJob.create;
  EmailJob.create = async () => { throw new Error('Injected distribution failure'); };
  try {
    await assert.rejects(distribute(input()), /Injected distribution failure/);
  } finally {
    EmailJob.create = originalCreate;
  }
  assert.equal(await Voucher.countDocuments(), 0);
  assert.equal(await Distribution.countDocuments(), 0);
  assert.equal(await Notification.countDocuments(), 0);
  assert.equal((await Template.findById(template._id)).redeemedCount, 0);
  assert.equal(published.length, 0);
  await telegram.reconcile();
  assert.equal(await Delivery.countDocuments(), 0);
});

async function legacyManualVoucher() {
  await distribute(input());
  const voucher = await Voucher.findOne({ source: 'manual' });
  await Voucher.updateOne({ _id: voucher._id }, { $unset: { telegramNotification: 1 } });
  return voucher;
}

test('reconciliation recovers a recent admin voucher from its original user notification exactly once', async () => {
  const voucher = await legacyManualVoucher();
  await telegram.reconcile();
  let recovered = await Voucher.findById(voucher._id);
  assert.ok(recovered.telegramNotification?.occurredAt);
  assert.equal(recovered.telegramNotification.occurredAt.getTime(), voucher.createdAt.getTime());
  assert.ok(recovered.telegramNotification.processedAt);
  let job = await Delivery.findOne({ voucherId: voucher._id });
  assert.ok(job, 'recovered manual voucher must reach the regular delivery queue');
  job.status = 'processing';
  job.leaseId = 'recovery-test';
  job.leaseUntil = new Date(Date.now() + 60000);
  await job.save();
  assert.equal((await telegram.processDelivery(job)).status, 'sent');
  await Delivery.updateOne({ _id: job._id }, { $set: { status: 'sent', messageId: 123 } });
  await telegram.reconcile();
  assert.equal(await Delivery.countDocuments({ voucherId: voucher._id }), 1);
  assert.equal(sends.length, 1);
  // The source marker continues preventing replay after the delivery TTL removes its job.
  await Delivery.deleteOne({ _id: job._id });
  await telegram.reconcile();
  assert.equal(await Delivery.countDocuments({ voucherId: voucher._id }), 0);
});

test('recovery excludes manual vouchers outside the one-day or rollout windows', async () => {
  const voucher = await legacyManualVoucher();
  const old = new Date(Date.now() - 25 * 3600000);
  await Voucher.collection.updateOne({ _id: voucher._id }, { $set: { createdAt: old } });
  process.env.TELEGRAM_EVENTS_FROM = new Date(Date.now() - 48 * 3600000).toISOString();
  await telegram.reconcile();
  assert.equal((await Voucher.findById(voucher._id)).telegramNotification, undefined);
  assert.equal(await Delivery.countDocuments(), 0);
  await Voucher.collection.updateOne({ _id: voucher._id }, { $set: { createdAt: new Date(Date.now() - 60000) } });
  process.env.TELEGRAM_EVENTS_FROM = new Date(Date.now() - 30000).toISOString();
  await telegram.reconcile();
  assert.equal((await Voucher.findById(voucher._id)).telegramNotification, undefined);
  assert.equal(await Delivery.countDocuments(), 0);
});

test('recovery requires a non-revoked voucher notification addressed to the same user', async () => {
  const voucher = await legacyManualVoucher();
  const notification = await Notification.findOne({ 'metadata.voucherId': String(voucher._id) });
  await Notification.updateOne({ _id: notification._id }, { $set: { isRevoked: true } });
  await telegram.reconcile();
  assert.equal((await Voucher.findById(voucher._id)).telegramNotification, undefined);
  await Notification.updateOne({ _id: notification._id }, { $set: { isRevoked: false, targetUsers: [admin._id] } });
  await telegram.reconcile();
  assert.equal((await Voucher.findById(voucher._id)).telegramNotification, undefined);
  await Notification.deleteOne({ _id: notification._id });
  await telegram.reconcile();
  assert.equal((await Voucher.findById(voucher._id)).telegramNotification, undefined);
  assert.equal(await Delivery.countDocuments(), 0);
});

test('a later Telegram link cannot receive a recovered voucher from before that link', async () => {
  const voucher = await legacyManualVoucher();
  await Link.updateOne({ userId: user._id }, { $set: { linkedAt: new Date(voucher.createdAt.getTime() + 1000) } });
  await telegram.reconcile();
  assert.ok((await Voucher.findById(voucher._id)).telegramNotification?.processedAt);
  assert.equal(await Delivery.countDocuments(), 0);
});

test('the disabled voucher flag prevents marker recovery as well as sending', async () => {
  const voucher = await legacyManualVoucher();
  process.env.TELEGRAM_VOUCHER_RECEIVED_ENABLED = 'false';
  await telegram.reconcile();
  assert.equal((await Voucher.findById(voucher._id)).telegramNotification, undefined);
  assert.equal(await Delivery.countDocuments(), 0);
});

test('25 earlier manual vouchers without valid notification evidence do not starve a later valid voucher', async () => {
  const voucher = await legacyManualVoucher();
  const invalid = Array.from({ length: 25 }, (_, index) => ({
    userId: user._id, templateId: template._id, source: 'manual', status: 'available',
    benefitSnapshot: { name: 'No notification evidence', type: 'FIXED_DISCOUNT', pointCost: 0, discountAmount: 1000, minimumAmount: 1000 },
    createdAt: new Date(voucher.createdAt.getTime() - 1000 - index),
    expiresAt: new Date(Date.now() + 86400000),
  }));
  await Voucher.collection.insertMany(invalid);
  await telegram.reconcile();
  assert.ok((await Voucher.findById(voucher._id)).telegramNotification?.processedAt);
  assert.equal(await Delivery.countDocuments({ voucherId: voucher._id }), 1);
  assert.equal(await Voucher.countDocuments({ telegramNotification: { $exists: false } }), 25);
});
