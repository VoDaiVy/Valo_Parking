// Isolated replica set: never connects to the application's database or sends real email.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const express = require('express');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const UserVoucher = require('../models/UserVoucher');
const Month = require('../models/SpendRewardMonth');
const Ledger = require('../models/SpendRewardLedger');
const EmailJob = require('../models/RewardEmailJob');
const Notification = require('../models/Notification');
const UserNotification = require('../models/UserNotification');
const Program = require('../models/SpendRewardProgram');
const Distribution = require('../models/VoucherDistribution');
const Template = require('../models/VoucherTemplate');
const Booking = require('../models/Booking');
const ParkingSession = require('../models/Session');
const Subscription = require('../models/Subscription');
const Service = require('../models/Service');
const BookingService = require('../models/BookingService');
const service = require('../services/spendRewardService');
const voucherService = require('../services/voucherService');
const { protect, authorize } = require('../middlewares/authMiddleware');
let repl, server, base, admin, customer, second;
const now = new Date('2026-10-01T03:00:00Z');
const secret = 'isolated-voucher-integration-test-secret';
const api = async (path, user, method = 'GET', body) => {
  const res = await fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json', ...(user ? { Authorization: `Bearer ${jwt.sign({ id: String(user._id) }, secret)}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: res.status, body: await res.json() };
};
before(async () => {
  process.env.JWT_SECRET = secret;
  repl = await MongoMemoryReplSet.create({ replSet: { count: 1 }, binary: { version: '7.0.14' } });
  await mongoose.connect(repl.getUri(), { dbName: 'voucher_integration_isolated' });
  await Promise.all([User, UserVoucher, Month, Ledger, EmailJob, Notification, UserNotification, Program, Distribution, Template, Booking, ParkingSession, Subscription, Service, BookingService].map((model) => model.init()));
  [admin, customer, second] = await User.create([
    { username: 'reward_admin', email: 'admin@example.test', role: 'admin' },
    { username: 'reward_customer', email: 'customer@example.test', role: 'customer' },
    { username: 'reward_second', email: 'second@example.test', role: 'customer' },
  ]);
  const app = express(); app.use(express.json());
  app.use('/admin/voucher-templates', protect, authorize('admin'), require('../routes/voucherTemplateRoutes'));
  app.use('/loyalty', require('../routes/loyaltyRoutes'));
  app.use((err, _req, res, _next) => res.status(err.statusCode || (['ValidationError', 'CastError'].includes(err.name) ? 400 : 500)).json({ success: false, message: err.message }));
  server = await new Promise((resolve) => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
  base = `http://127.0.0.1:${server.address().port}`;
}, { timeout: 180000 });
after(async () => { if (server) await new Promise((resolve) => server.close(resolve)); await mongoose.disconnect(); if (repl) await repl.stop(); });

test('HTTP roles, retired points, config validation and optimistic concurrency', async () => {
  assert.equal((await api('/admin/voucher-templates/spending-program')).status, 401);
  assert.equal((await api('/admin/voucher-templates/spending-program', customer)).status, 403);
  assert.equal((await api('/loyalty/redeem', customer, 'POST', { templateId: new mongoose.Types.ObjectId() })).status, 410);
  const config = await service.getProgram();
  assert.equal((await api('/admin/voucher-templates/spending-program', admin, 'PUT', { enabled: true, revision: 0, tiers: [] })).status, 400);
  await service.saveProgram({ enabled: true, revision: config.revision, tiers: config.tiers.map((tier) => tier.toObject()) }, new Date(now.getTime() - 1000));
  assert.equal((await api('/admin/voucher-templates/spending-program', admin, 'PUT', { enabled: true, revision: 0, tiers: config.tiers })).status, 409);
});

test('admin can edit expiry for unused vouchers with validation and cannot edit used vouchers', async () => {
  const expiryUser = await User.create({ username: 'expiry_admin_test', email: 'expiry-admin@example.test' });
  const voucher = await UserVoucher.create({ userId: expiryUser._id, templateId: new mongoose.Types.ObjectId(), source: 'manual', rewardKey: 'expiry-admin-test',
    benefitSnapshot: { name: 'Expiry test', type: 'FIXED_DISCOUNT', pointCost: 0, discountAmount: 20000, minimumAmount: 100000 },
    redeemedAt: new Date(), expiresAt: new Date(Date.now() + 86400000) });
  const past = await api(`/admin/voucher-templates/issued/${voucher._id}/expiry`, admin, 'PATCH', { expiresAt: new Date(Date.now() - 1000).toISOString() });
  assert.equal(past.status, 400);
  const next = new Date(Date.now() + 14 * 86400000);
  const updated = await api(`/admin/voucher-templates/issued/${voucher._id}/expiry`, admin, 'PATCH', { expiresAt: next.toISOString() });
  assert.equal(updated.status, 200, JSON.stringify(updated.body));
  assert.equal(new Date(updated.body.data.expiresAt).getTime(), next.getTime());
  await UserVoucher.updateOne({ _id: voucher._id }, { status: 'used' });
  const used = await api(`/admin/voucher-templates/issued/${voucher._id}/expiry`, admin, 'PATCH', { expiresAt: new Date(Date.now() + 20 * 86400000).toISOString() });
  assert.equal(used.status, 400);
});

test('automatic issue is atomic, concurrent-safe, highest-only, email failure does not lose voucher', async () => {
  const event = { sourceKey: 'test-payment:1', userId: customer._id, amount: 800000, occurredAt: now };
  await Promise.all([service.applySpend(event, now), service.applySpend(event, now), service.applySpend(event, now)]);
  assert.equal(await UserVoucher.countDocuments({ userId: customer._id }), 1);
  assert.equal((await Month.findOne({ userId: customer._id })).total, 800000);
  const voucher = await UserVoucher.findOne({ userId: customer._id });
  assert.equal(voucher.rewardThreshold, 700000);
  assert.equal(voucher.expiresAt - voucher.redeemedAt, 604800000);
  assert.equal(await UserNotification.countDocuments({ userId: customer._id }), 1);
  const notification = await Notification.findOne({ 'metadata.voucherId': String(voucher._id) });
  assert.deepEqual(notification.targetUsers.map(String), [String(customer._id)]);
  assert.equal(await UserNotification.countDocuments({ notificationId: notification._id, userId: second._id }), 0);
  assert.equal(await EmailJob.countDocuments({ voucherId: voucher._id }), 1);
  await service.deliverEmails({ now, send: async () => { throw new Error('SMTP temporarily unavailable'); } });
  assert.equal((await EmailJob.findOne({ voucherId: voucher._id })).status, 'pending');
  assert.ok((await api('/admin/voucher-templates/spending-program', admin)).body.data.stats.retryingEmails >= 1);
  let sent = 0;
  await service.deliverEmails({ now: new Date(now.getTime() + 300000), send: async () => { sent++; } });
  await service.deliverEmails({ now: new Date(now.getTime() + 400000), send: async () => { sent++; } });
  assert.equal(sent, 1);
  assert.equal((await EmailJob.findOne({ voucherId: voucher._id })).status, 'sent');
});

test('refund revokes unused reward; restoring spend cannot re-award consumed milestone; month resets', async () => {
  const event = { sourceKey: 'test-payment:1', userId: customer._id, amount: 100000, occurredAt: now };
  await service.applySpend(event, now);
  assert.equal((await UserVoucher.findOne({ userId: customer._id })).status, 'revoked');
  await service.applySpend({ ...event, amount: 800000 }, now);
  assert.equal(await UserVoucher.countDocuments({ userId: customer._id }), 1);
  await service.applySpend({ ...event, sourceKey: 'test-payment:november', occurredAt: new Date('2026-10-31T17:00:00Z'), amount: 300000 }, new Date('2026-10-31T17:00:00Z'));
  assert.equal(await UserVoucher.countDocuments({ userId: customer._id }), 2);
});

test('admin creates and distributes without points; dedup, recipient validation and stock limit', async () => {
  const created = await api('/admin/voucher-templates', admin, 'POST', { name: 'Direct reward', type: 'FIXED_DISCOUNT', discountAmount: 20000, minimumAmount: 100000, redemptionLimit: 2 });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const id = created.body.data._id;
  const bad = await api(`/admin/voucher-templates/${id}/distribute`, admin, 'POST', { requestId: 'invalid-recipient-request', userIds: [String(admin._id)] });
  assert.equal(bad.status, 400);
  assert.equal((await Template.findById(id)).redeemedCount, 0);
  const selectedExpiry = new Date(Date.now() + 21 * 86400000);
  const payload = { requestId: 'manual-send-integration-001', expiresAt: selectedExpiry.toISOString(), userIds: [String(customer._id), String(second._id), String(second._id)] };
  const responses = await Promise.all([api(`/admin/voucher-templates/${id}/distribute`, admin, 'POST', payload), api(`/admin/voucher-templates/${id}/distribute`, admin, 'POST', payload)]);
  for (const response of responses) assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(await UserVoucher.countDocuments({ templateId: id }), 2);
  assert.equal((await UserVoucher.findOne({ templateId: id })).expiresAt.getTime(), selectedExpiry.getTime());
  assert.equal((await Template.findById(id)).redeemedCount, 2);
  assert.equal((await api(`/admin/voucher-templates/${id}/distribute`, admin, 'POST', { ...payload, requestId: 'manual-send-integration-002' })).status, 409);
  assert.equal((await api(`/admin/voucher-templates/${id}/distribute`, admin, 'POST', { ...payload, userIds: [String(second._id)] })).status, 409);
  const owned = await api('/loyalty/vouchers', second);
  assert.equal(owned.status, 200);
  assert.equal(owned.body.data.length, 1);
});

test('voucher preview enforces owner, minimum, expiry; reservation excludes parallel booking', async () => {
  const voucher = await UserVoucher.findOne({ userId: second._id, source: 'manual' });
  await assert.rejects(voucherService.previewVoucher({ voucherId: voucher._id, userId: admin._id, amount: 100000 }), { code: 'VOUCHER_NOT_FOUND' });
  await assert.rejects(voucherService.previewVoucher({ voucherId: voucher._id, userId: second._id, amount: 99999 }), { code: 'VOUCHER_MINIMUM_AMOUNT' });
  const preview = await voucherService.previewVoucher({ voucherId: voucher._id, userId: second._id, amount: 100000 });
  assert.equal(preview.discountedAmount, 80000);
  const booking = { _id: new mongoose.Types.ObjectId(), userId: second._id, prepaidAmount: 100000, paymentBreakdownSnapshot: {} };
  await voucherService.validateAndApplyVoucher({ voucherId: voucher._id, booking });
  assert.equal(booking.prepaidAmount, 80000);
  await assert.rejects(voucherService.previewVoucher({ voucherId: voucher._id, userId: second._id, amount: 100000 }), { code: 'VOUCHER_RESERVED' });
  await voucherService.releaseVoucherReservation({ bookingId: booking._id });
  await UserVoucher.updateOne({ _id: voucher._id }, { expiresAt: new Date(Date.now() - 1) });
  await assert.rejects(voucherService.previewVoucher({ voucherId: voucher._id, userId: second._id, amount: 100000 }), { code: 'VOUCHER_EXPIRED' });
});

test('durable source reconciliation counts completed net payments and excludes duplicate parking sessions', async () => {
  const user = await User.create({ username: 'source_customer', email: 'sources@example.test' });
  const id = new mongoose.Types.ObjectId();
  await Booking.collection.insertOne({ _id: id, userId: user._id, status: 'COMPLETED', completedAt: now, prepaidAmount: 350000, refundSettlements: [{ payoutStatus: 'credited', netWalletAmount: 50000 }] });
  await ParkingSession.collection.insertMany([
    { userId: user._id, bookingId: id, status: 'completed', paymentStatus: 'paid', totalPrice: 350000, checkOutTime: now },
    { userId: user._id, bookingId: null, status: 'completed', paymentStatus: 'unpaid', totalPrice: 900000, checkOutTime: now },
  ]);
  await service.reconcileSpending(now);
  await service.reconcileSpending(now);
  assert.equal((await Month.findOne({ userId: user._id })).total, 300000);
  assert.equal(await UserVoucher.countDocuments({ userId: user._id }), 1);
  await Booking.collection.updateOne({ _id: id }, { $set: { status: 'CANCELLED' } });
  await service.reconcileSpending(now);
  assert.equal((await Month.findOne({ userId: user._id })).total, 0);
  assert.equal((await UserVoucher.findOne({ userId: user._id })).status, 'revoked');
});

test('subscription payment and renewal are durable, counted once, then reversed on cancellation', async () => {
  const user = await User.create({ username: 'subscriber_reward', email: 'subscriber@example.test' });
  const subscription = await Subscription.create({ user: user._id, ticketPackage: new mongoose.Types.ObjectId(),
    amount: 200000, orderCode: 987654321, expireAt: new Date(Date.now() + 86400000), paymentStatus: 'paid', status: 'active',
  });
  assert.equal(subscription.rewardPayments.length, 1);
  subscription.rewardPayments.push({ orderCode: 987654322, userId: user._id, amount: 120000, paidAt: new Date() });
  await subscription.save();
  assert.equal(subscription.rewardPayments.length, 2);
  await service.reconcileSpending(); await service.reconcileSpending();
  assert.equal((await Month.findOne({ userId: user._id })).total, 320000);
  assert.equal(await UserVoucher.countDocuments({ userId: user._id }), 1);
  subscription.status = 'cancelled'; await subscription.save();
  await service.reconcileSpending();
  assert.equal((await Month.findOne({ userId: user._id })).total, 0);
});

test('out-of-order source snapshots do not undo refunds; disabling prevents new rewards', async () => {
  const user = await User.create({ username: 'stale_source_test', email: 'stale@example.test' });
  const event = { sourceKey: 'stale-payment', userId: user._id, occurredAt: now, amount: 400000, sourceUpdatedAt: now };
  await service.applySpend(event, now);
  await service.applySpend({ ...event, amount: 100000, sourceUpdatedAt: new Date(now.getTime() + 5000) }, now);
  await service.applySpend(event, now);
  assert.equal((await Month.findOne({ userId: user._id })).total, 100000);
  const config = await service.getProgram();
  await service.saveProgram({ enabled: false, revision: config.revision, tiers: config.tiers.map((tier) => tier.toObject()) });
  await service.applySpend({ ...event, sourceKey: 'disabled-payment', amount: 1500000 }, now);
  assert.equal(await UserVoucher.countDocuments({ userId: user._id, status: 'available' }), 0);
});

test('reserved voucher becomes used on payment, cannot be reserved twice or used by another owner', async () => {
  const template = await Template.create({ name: 'Use once', type: 'PERCENT_DISCOUNT', discountPercent: 20 });
  await require('../services/voucherDistributionService').distribute({ templateId: template._id, createdBy: admin._id, requestId: 'single-use-payment-test', userIds: [String(second._id)] });
  const voucher = await UserVoucher.findOne({ templateId: template._id });
  const booking = { _id: new mongoose.Types.ObjectId(), userId: second._id, prepaidAmount: 100000, paymentBreakdownSnapshot: {} };
  await voucherService.validateAndApplyVoucher({ voucherId: voucher._id, booking });
  assert.equal(booking.prepaidAmount, 80000);
  await Booking.collection.insertOne({ ...booking, status: 'PAID' });
  await voucherService.markVoucherUsed({ bookingId: booking._id });
  assert.equal((await UserVoucher.findById(voucher._id)).status, 'used');
  await voucherService.markVoucherUsed({ bookingId: booking._id });
  await assert.rejects(voucherService.previewVoucher({ voucherId: voucher._id, userId: second._id, amount: 100000 }), { code: 'VOUCHER_ALREADY_USED' });
});

test('reward email contains benefit, minimum, exact expiry and deterministic message id', async () => {
  const nodemailer = require('nodemailer');
  const original = nodemailer.createTransport;
  let sent;
  nodemailer.createTransport = () => ({ sendMail: async (message) => { sent = message; } });
  try {
    const voucher = await UserVoucher.findOne({ source: 'manual', 'benefitSnapshot.type': 'FIXED_DISCOUNT' });
    await require('../utils/emailUtils').sendSpendRewardEmail('test@example.test', voucher);
    assert.match(sent.text, /20\.000/);
    assert.match(sent.text, /100\.000/);
    assert.match(sent.text, /Hạn sử dụng:/);
    assert.doesNotMatch(sent.text, /Có hiệu lực 7 ngày kể từ lúc cấp/);
    assert.match(sent.text, /customer\/rewards/);
    assert.equal(sent.to, 'test@example.test');
    assert.ok(sent.messageId.includes(String(voucher._id)));
  } finally { nodemailer.createTransport = original; }
});

test('admin-only quarterly leaderboard uses Vietnam quarters, refunds and historical selection', async () => {
  const first = await User.create({ username: 'quarter_first', email: 'quarter-first@example.test' });
  const other = await User.create({ username: 'quarter_other', email: 'quarter-other@example.test' });
  const dates = ['2026-10-05T00:00:00Z', '2026-12-20T00:00:00Z', '2027-01-02T00:00:00Z'];
  await service.applySpend({ sourceKey: 'quarter:a', userId: first._id, amount: 4000000, occurredAt: new Date(dates[0]) }, new Date(dates[0]));
  await service.applySpend({ sourceKey: 'quarter:b', userId: other._id, amount: 3000000, occurredAt: new Date(dates[1]) }, new Date(dates[1]));
  await service.applySpend({ sourceKey: 'quarter:c', userId: other._id, amount: 7000000, occurredAt: new Date(dates[2]) }, new Date(dates[2]));
  const leaderboard = require('../services/quarterlyLeaderboardService');
  let result = await leaderboard.getLeaderboard({ quarter: '2026-Q4', now: new Date('2027-01-03T00:00:00Z') });
  assert.deepEqual(result.availableQuarters, ['2027-Q1', '2026-Q4']);
  assert.equal(result.leaders[0].username, 'quarter_first');
  assert.equal(result.leaders[0].email, undefined);
  await service.applySpend({ sourceKey: 'quarter:a', userId: first._id, amount: 1000000, occurredAt: new Date(dates[0]) }, new Date(dates[0]));
  result = await leaderboard.getLeaderboard({ quarter: '2026-Q4', now: new Date('2027-01-03T00:00:00Z') });
  assert.equal(result.leaders[0].username, 'quarter_other');
  assert.equal((await leaderboard.getLeaderboard({ quarter: '2027-Q1', now: new Date('2027-01-03T00:00:00Z') })).leaders[0].username, 'quarter_other');
  await assert.rejects(leaderboard.getLeaderboard({ quarter: '2027-Q5' }), { statusCode: 400 });
  await assert.rejects(leaderboard.getLeaderboard({ quarter: '2028-Q1', now: new Date('2027-01-03T00:00:00Z') }), { statusCode: 400 });
  assert.equal((await fetch(`${base}/loyalty/leaderboard`, { headers: { Authorization: `Bearer ${jwt.sign({ id: String(customer._id) }, secret)}` } })).status, 404);
  assert.equal((await api('/admin/voucher-templates/leaderboard', customer)).status, 403);
  assert.equal((await api('/admin/voucher-templates/leaderboard?quarter=2026-Q4', admin)).status, 200);
  assert.equal((await api('/admin/voucher-templates/leaderboard?quarter=2027-Q5', admin)).status, 400);
});

test('direct sends create exactly one private notification and email job per recipient; expired jobs cancel', async () => {
  const distribution = await Distribution.findOne({ requestId: 'manual-send-integration-001' });
  const issued = await UserVoucher.find({ rewardKey: { $regex: `^manual:${distribution.requestId}:` } });
  assert.equal(issued.length, 2);
  for (const voucher of issued) {
    const job = await EmailJob.findOne({ voucherId: voucher._id });
    assert.ok(job);
    const notification = await Notification.findOne({ 'metadata.voucherId': String(voucher._id) });
    assert.deepEqual(notification.targetUsers.map(String), [String(voucher.userId)]);
    assert.equal(await UserNotification.countDocuments({ notificationId: notification._id, userId: voucher.userId }), 1);
  }
  const voucher = issued[0];
  await UserVoucher.updateOne({ _id: voucher._id }, { $set: { expiresAt: new Date('2026-01-01T00:00:00Z') } });
  await service.deliverEmails({ now: new Date(), send: async () => {} });
  assert.equal((await EmailJob.findOne({ voucherId: voucher._id })).status, 'cancelled');
});

test('live reward notification reaches its recipient without broadcasting to admins or another customer', async () => {
  const { onlineUsers } = require('../sockets/notificationSocket');
  const notifications = [];
  const adminEvents = [];
  const recipient = { userRole: 'customer', emit: (event) => notifications.push(event) };
  const administrator = { userRole: 'admin', emit: (event) => adminEvents.push(event) };
  const io = { sockets: { sockets: new Map([['recipient-socket', recipient], ['admin-socket', administrator]]) },
    to: (id) => ({ emit: (event, payload) => {
      if (id === 'recipient-socket') notifications.push({ event, payload });
      if (id === 'admin-socket') adminEvents.push({ event, payload });
    } }),
  };
  onlineUsers.set(String(customer._id), new Set(['recipient-socket']));
  onlineUsers.set(String(admin._id), new Set(['admin-socket']));
  try {
    const notification = await Notification.findOne({ targetUsers: customer._id });
    require('../services/rewardNotificationDelivery').publishNotifications({ get: () => io }, [notification]);
    const received = notifications.find((item) => item.event === 'notification:new');
    assert.equal(String(received.payload._id), String(notification._id));
    assert.equal(received.payload.targetUsers, undefined);
    assert.equal(adminEvents.length, 0);
  } finally {
    onlineUsers.delete(String(customer._id)); onlineUsers.delete(String(admin._id));
  }
});

test('end-to-end manual voucher: admin API to recipient notification/email, discounted paid booking, single use', async () => {
  const recipient = await User.create({ username: 'voucher_journey', email: 'voucher-journey@example.test' });
  const created = await api('/admin/voucher-templates', admin, 'POST', {
    name: 'Journey discount', type: 'FIXED_DISCOUNT', discountAmount: 25000, minimumAmount: 100000,
  });
  assert.equal(created.status, 201);
  const templateId = created.body.data._id;
  const issued = await api(`/admin/voucher-templates/${templateId}/distribute`, admin, 'POST', {
    requestId: 'voucher-journey-request-001', userIds: [String(recipient._id)],
  });
  assert.equal(issued.status, 200);
  const customerList = await api('/loyalty/vouchers?status=available', recipient);
  assert.equal(customerList.status, 200);
  assert.equal(customerList.body.data.length, 1);
  const voucher = customerList.body.data[0];
  assert.equal(voucher.benefitSnapshot.discountAmount, 25000);
  assert.equal(await UserNotification.countDocuments({ userId: recipient._id }), 1);
  let mailTo;
  await service.deliverEmails({ send: async (address, deliveredVoucher) => {
    if (String(deliveredVoucher._id) === String(voucher._id)) mailTo = address;
  } });
  assert.equal(mailTo, recipient.email);
  assert.equal((await EmailJob.findOne({ voucherId: voucher._id })).status, 'sent');
  const booking = { _id: new mongoose.Types.ObjectId(), userId: recipient._id, prepaidAmount: 125000, paymentBreakdownSnapshot: {} };
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      await voucherService.validateAndApplyVoucher({ voucherId: voucher._id, booking, session });
      assert.equal(booking.prepaidAmount, 100000);
      await Booking.collection.insertOne({ ...booking, status: 'PAID' }, { session });
      await voucherService.markVoucherUsed({ bookingId: booking._id, session });
    });
  } finally { await session.endSession(); }
  assert.equal((await UserVoucher.findById(voucher._id)).status, 'used');
  assert.equal((await api('/loyalty/vouchers?status=available', recipient)).body.data.length, 0);
  assert.equal((await api('/loyalty/vouchers?status=used', recipient)).body.data.length, 1);
  await assert.rejects(voucherService.previewVoucher({ voucherId: voucher._id, userId: recipient._id, amount: 125000 }), { code: 'VOUCHER_ALREADY_USED' });
});

test('percentage and free-service vouchers quote and apply their actual benefits', async () => {
  const user = await User.create({ username: 'voucher_benefits', email: 'voucher-benefits@example.test' });
  const serviceItem = await Service.create({ name: 'Car wash reward', description: 'Exterior wash', price: 30000 });
  for (const [type, body, expected] of [
    ['PERCENT_DISCOUNT', { discountPercent: 20 }, 80000],
    ['FREE_SERVICE', { serviceId: String(serviceItem._id) }, 100000],
  ]) {
    const created = await api('/admin/voucher-templates', admin, 'POST', { name: `Benefit ${type}`, type, ...body });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const distributed = await api(`/admin/voucher-templates/${created.body.data._id}/distribute`, admin, 'POST', {
      requestId: `benefit-${type.toLowerCase().replaceAll('_', '-')}-request-001`, userIds: [String(user._id)],
    });
    assert.equal(distributed.status, 200);
    const voucher = await UserVoucher.findOne({ templateId: created.body.data._id });
    const serviceIds = type === 'FREE_SERVICE' ? [serviceItem._id] : [];
    const base = type === 'FREE_SERVICE' ? 130000 : 100000;
    const preview = await voucherService.previewVoucher({ voucherId: voucher._id, userId: user._id, amount: base, serviceIds });
    assert.equal(preview.discountedAmount, expected);
    const booking = { _id: new mongoose.Types.ObjectId(), userId: user._id, prepaidAmount: base, paymentBreakdownSnapshot: {} };
    await voucherService.validateAndApplyVoucher({ voucherId: voucher._id, booking, serviceIds });
    assert.equal(booking.prepaidAmount, expected);
    assert.equal(booking.paymentBreakdownSnapshot.voucherDiscount, type === 'FREE_SERVICE' ? 30000 : 20000);
    if (type === 'FREE_SERVICE') {
      const bookedService = await BookingService.findOne({ bookingId: booking._id, serviceId: serviceItem._id });
      assert.equal(bookedService.price, 0);
    }
  }
});

test('end-to-end automatic reward: paid future booking, reconciliation, email, then a new discounted booking', async () => {
  const recipient = await User.create({ username: 'automatic_journey', email: 'automatic-journey@example.test' });
  const program = await service.getProgram();
  await service.saveProgram({ enabled: true, revision: program.revision, tiers: [
    { threshold: 700000, discountAmount: 50000, minimumAmount: 50000 },
    { threshold: 1000000, discountAmount: 20000, minimumAmount: 50000 },
    { threshold: 1500000, discountAmount: 100000, minimumAmount: 400000 },
  ] });
  const paidAt = new Date();
  const originalId = new mongoose.Types.ObjectId();
  await Booking.collection.insertOne({ _id: originalId, userId: recipient._id, status: 'PAID', paidAt, prepaidAmount: 1505000,
    scheduledStart: new Date(paidAt.getTime() + 3600000), scheduledEnd: new Date(paidAt.getTime() + 86400000) });
  await service.reconcileSpending(paidAt);
  const reward = await UserVoucher.findOne({ userId: recipient._id, source: 'spending' });
  assert.ok(reward);
  assert.equal(reward.rewardThreshold, 1500000);
  assert.equal(reward.benefitSnapshot.discountAmount, 100000);
  assert.equal(reward.expiresAt - reward.redeemedAt, 604800000);
  const { quarterOf, getLeaderboard } = require('../services/quarterlyLeaderboardService');
  const leaderboard = await getLeaderboard({ quarter: quarterOf(require('../services/spendRewardRules').monthOf(paidAt)), now: paidAt });
  assert.ok(leaderboard.leaders.some((row) => String(row.userId) === String(recipient._id) && row.total === 1505000));
  assert.equal(await UserNotification.countDocuments({ userId: recipient._id }), 1);
  let delivered = false;
  await service.deliverEmails({ now: paidAt, send: async (address, voucher) => {
    if (String(voucher._id) === String(reward._id)) {
      assert.equal(address, recipient.email);
      delivered = true;
    }
  } });
  assert.equal(delivered, true);
  const booking = { _id: new mongoose.Types.ObjectId(), userId: recipient._id, createdAt: new Date(reward.redeemedAt.getTime() + 1000), prepaidAmount: 400000, paymentBreakdownSnapshot: {} };
  await voucherService.validateAndApplyVoucher({ voucherId: reward._id, booking });
  assert.equal(booking.prepaidAmount, 300000);
  await Booking.collection.insertOne({ ...booking, status: 'PAID' });
  await voucherService.markVoucherUsed({ bookingId: booking._id });
  assert.equal((await UserVoucher.findById(reward._id)).status, 'used');
  await service.reconcileSpending(new Date(paidAt.getTime() + 2000));
  assert.equal(await UserVoucher.countDocuments({ userId: recipient._id, source: 'spending' }), 1);
});

test('paid booking immediately updates spending, leaderboard, notification and email without waiting for completion or a scan', async () => {
  const recipient = await User.create({ username: 'immediate_paid_reward', email: 'immediate-paid@example.test' });
  const paidAt = new Date();
  const bookingId = new mongoose.Types.ObjectId();
  await Booking.collection.insertOne({ _id: bookingId, userId: recipient._id, status: 'PAID', paidAt,
    prepaidAmount: 1505000, scheduledStart: new Date(paidAt.getTime() + 3600000), scheduledEnd: new Date(paidAt.getTime() + 86400000) });
  let emails = 0;
  const send = async (address) => { assert.equal(address, recipient.email); emails++; };
  const reward = await service.processPaidBooking(bookingId, undefined, { now: paidAt, send });
  assert.ok(reward);
  assert.equal(reward.rewardThreshold, 1500000);
  assert.equal((await Month.findOne({ userId: recipient._id })).total, 1505000);
  assert.equal(await UserNotification.countDocuments({ userId: recipient._id }), 1);
  assert.equal((await EmailJob.findOne({ voucherId: reward._id })).status, 'sent');
  const { quarterOf, getLeaderboard } = require('../services/quarterlyLeaderboardService');
  const leaderboard = await getLeaderboard({ quarter: quarterOf(require('../services/spendRewardRules').monthOf(paidAt)), now: paidAt });
  assert.ok(leaderboard.leaders.some((row) => String(row.userId) === String(recipient._id) && row.total === 1505000));
  assert.equal(await service.processPaidBooking(bookingId, undefined, { now: paidAt, send }), null);
  assert.equal(emails, 1);
  assert.equal(await UserVoucher.countDocuments({ userId: recipient._id, source: 'spending' }), 1);
});

test('paid booking refund lowers monthly spending and quarterly rank, revoking an unused reward', async () => {
  const recipient = await User.create({ username: 'paid_refund_journey', email: 'paid-refund@example.test' });
  const paidAt = new Date();
  const id = new mongoose.Types.ObjectId();
  await Booking.collection.insertOne({ _id: id, userId: recipient._id, status: 'PAID', paidAt, prepaidAmount: 800000 });
  await service.reconcileSpending(paidAt);
  assert.equal((await Month.findOne({ userId: recipient._id, month: require('../services/spendRewardRules').monthOf(paidAt) })).total, 800000);
  const reward = await UserVoucher.findOne({ userId: recipient._id, source: 'spending' });
  assert.equal(reward.status, 'available');
  await Booking.collection.updateOne({ _id: id }, { $set: { status: 'CANCELLED', updatedAt: new Date(paidAt.getTime() + 1000),
    refundSettlements: [{ payoutStatus: 'credited', netWalletAmount: 600000 }] } });
  await service.reconcileSpending(new Date(paidAt.getTime() + 2000));
  assert.equal((await Month.findOne({ userId: recipient._id })).total, 200000);
  assert.equal((await UserVoucher.findById(reward._id)).status, 'revoked');
  const { quarterOf, getLeaderboard } = require('../services/quarterlyLeaderboardService');
  const ranking = await getLeaderboard({ quarter: quarterOf(require('../services/spendRewardRules').monthOf(paidAt)), now: paidAt });
  assert.ok(ranking.leaders.some((row) => String(row.userId) === String(recipient._id) && row.total === 200000));
});
