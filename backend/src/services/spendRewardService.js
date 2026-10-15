const mongoose = require('mongoose');
const { randomUUID } = require('crypto');
const Program = require('../models/SpendRewardProgram');
const Ledger = require('../models/SpendRewardLedger');
const Month = require('../models/SpendRewardMonth');
const EmailJob = require('../models/RewardEmailJob');
const UserVoucher = require('../models/UserVoucher');
const User = require('../models/User');
const Notification = require('../models/Notification');
const UserNotification = require('../models/UserNotification');
const { WEEK_MS, monthOf, validateProgram, selectTier, bookingSpend, money } = require('./spendRewardRules');

const getProgram = () => Program.findOneAndUpdate({ _id: 'monthly' }, { $setOnInsert: { _id: 'monthly' } }, { upsert: true, new: true });
async function saveProgram(input, now = new Date()) {
  const normalized = validateProgram(input);
  const current = await getProgram();
  // Keep the original launch date across pauses; never retrospectively reward old purchases.
  const updated = await Program.findOneAndUpdate({ _id: 'monthly', revision: input.revision }, {
    $set: { ...normalized, startsAt: current.startsAt || (normalized.enabled ? now : null) },
    $inc: { revision: 1 },
  }, { new: true, runValidators: true });
  if (!updated) throw Object.assign(new Error('Settings changed. Reload before saving.'), { statusCode: 409 });
  return updated;
}

async function applySpend(event, now = new Date(), app) {
  if (!mongoose.isValidObjectId(event.userId) || !event.sourceKey) throw new Error('Invalid spending source');
  money(event.amount);
  const month = monthOf(event.occurredAt);
  // Retry unique-key races on first creation; subsequent updates serialize on the monthly row.
  for (let attempt = 0; attempt < 4; attempt++) {
    const session = await mongoose.startSession();
    try {
      let result = null;
      let issuedNotification = null;
      await session.withTransaction(async () => {
        result = null;
        issuedNotification = null;
        const program = await Program.findById('monthly').session(session);
        if (!program?.startsAt || new Date(event.occurredAt) < program.startsAt) return;
        const user = await User.findOne({ _id: event.userId, role: 'customer', status: true }).session(session);
        if (!user) return;
        const previous = await Ledger.findOne({ sourceKey: event.sourceKey }).session(session);
        if (previous?.sourceUpdatedAt && event.sourceUpdatedAt && previous.sourceUpdatedAt > new Date(event.sourceUpdatedAt)) return;
        if (previous && (String(previous.userId) !== String(event.userId) || previous.month !== month)) throw new Error('Spending source identity cannot change');
        if (previous?.amount === event.amount) {
          if (event.sourceUpdatedAt) await Ledger.updateOne({ _id: previous._id }, { $max: { sourceUpdatedAt: event.sourceUpdatedAt } }, { session });
          return;
        }
        const delta = event.amount - (previous?.amount || 0);
        const state = await Month.findOneAndUpdate({ userId: event.userId, month }, {
          $setOnInsert: { userId: event.userId, month, highestAwardedThreshold: 0 },
          $inc: { total: delta },
        }, { session, upsert: true, new: true });
        await Ledger.updateOne({ sourceKey: event.sourceKey }, { $set: { ...event, month } }, { session, upsert: true, runValidators: true });
        // A refund never awards another voucher or restores an already consumed milestone.
        await UserVoucher.updateMany({ userId: event.userId, rewardMonth: month, source: 'spending', status: 'available', bookingId: null, rewardThreshold: { $gt: state.total } }, {
          $set: { status: 'revoked' },
        }, { session });
        if (!program.enabled || delta <= 0) return;
        const tier = selectTier(program.tiers, state.total, state.highestAwardedThreshold);
        if (!tier) return;
        state.highestAwardedThreshold = tier.threshold;
        await state.save({ session });
        const rewardKey = `${event.userId}:${month}:${tier.threshold}`;
        const validityDays = program.validityDays || 7;
        const [voucher] = await UserVoucher.create([{
          userId: event.userId, source: 'spending', rewardKey, rewardMonth: month, rewardThreshold: tier.threshold,
          benefitSnapshot: {
            name: `Monthly spending reward - ${tier.discountAmount.toLocaleString('vi-VN')} VND`,
            description: `Minimum booking ${tier.minimumAmount.toLocaleString('vi-VN')} VND. One use within ${validityDays} days.`,
            type: 'FIXED_DISCOUNT', pointCost: 0, discountAmount: tier.discountAmount, minimumAmount: tier.minimumAmount,
          },
          redeemedAt: now, expiresAt: new Date(now.getTime() + validityDays * 24 * 60 * 60 * 1000),
        }], { session });
        const [notification] = await Notification.create([{
          title: 'You received a spending reward',
          content: `${voucher.benefitSnapshot.name}. ${voucher.benefitSnapshot.description}`,
          type: 'PROMOTION', priority: 'SUCCESS', targetType: 'SINGLE_USER', targetUsers: [user._id], recipientCount: 1,
          metadata: { voucherId: String(voucher._id), rewardKey, deepLink: '/customer/rewards', expiresAt: voucher.expiresAt },
        }], { session });
        await UserNotification.create([{ userId: user._id, notificationId: notification._id }], { session });
        await EmailJob.create([{ voucherId: voucher._id, nextAttemptAt: now }], { session });
        result = voucher;
        issuedNotification = notification;
      });
      if (issuedNotification) require('./rewardNotificationDelivery').publishNotifications(app, [issuedNotification]);
      return result;
    } catch (error) {
      if (error.code !== 11000 || attempt === 3) throw error;
    } finally { await session.endSession(); }
  }
}

async function reconcileSpending(now = new Date(), app) {
  const program = await getProgram();
  if (!program.startsAt) return;
  // Read durable settlement records, not HTTP callbacks. Replays and restarts are safe.
  // Include cancelled/refunded records so previous credit can be reversed.
  const Booking = require('../models/Booking');
  const ParkingSession = require('../models/Session');
  const Subscription = require('../models/Subscription');
  const events = [];
  for await (const booking of Booking.find({ userId: { $ne: null }, $or: [
    { paidAt: { $gte: program.startsAt } },
    { paidAt: null, completedAt: { $gte: program.startsAt } },
  ] }).lean().cursor()) {
    events.push({ sourceKey: `booking:${booking._id}`, userId: booking.userId,
      occurredAt: booking.paidAt || booking.completedAt, sourceUpdatedAt: booking.updatedAt,
      amount: bookingSpend(booking) });
  }
  for await (const parking of ParkingSession.find({ checkOutTime: { $gte: program.startsAt }, bookingId: null, userId: { $ne: null } }).lean().cursor()) {
    events.push({ sourceKey: `parking:${parking._id}`, userId: parking.userId, occurredAt: parking.checkOutTime, sourceUpdatedAt: parking.updatedAt,
      amount: parking.status === 'completed' && parking.paymentStatus === 'paid'
        ? money(parking.settledPaidAmount ?? (parking.type === 'SUBSCRIPTION' ? 0 : parking.totalPrice)) : 0 });
  }
  for await (const subscription of Subscription.find({ 'rewardPayments.paidAt': { $gte: program.startsAt } }).lean().cursor()) {
    for (const payment of subscription.rewardPayments || []) {
      if (payment.paidAt < program.startsAt) continue;
      events.push({ sourceKey: `subscription:${subscription._id}:${payment.paymentKey || payment.orderCode}`, userId: payment.userId,
        occurredAt: payment.paidAt, sourceUpdatedAt: subscription.updatedAt, amount: subscription.paymentStatus === 'paid' && ['active', 'expired'].includes(subscription.status) ? money(payment.amount) : 0 });
    }
  }
  for (const modelName of ['SubscriptionRenewal', 'MembershipEntitlementRenewal']) {
    const Renewal = require(`../models/${modelName}`);
    for await (const renewal of Renewal.find({ paidAt: { $gte: program.startsAt } }).lean().cursor()) {
      events.push({ sourceKey: `${modelName}:${renewal._id}`, userId: renewal.userId, occurredAt: renewal.paidAt,
        sourceUpdatedAt: renewal.updatedAt, amount: renewal.status === 'paid' ? money(renewal.amount) : 0 });
    }
  }
  events.sort((a, b) => new Date(a.occurredAt) - new Date(b.occurredAt) || a.sourceKey.localeCompare(b.sourceKey));
  for (const event of events) {
    try { await applySpend(event, now, app); }
    catch (error) { console.error(`[SpendRewards] ${event.sourceKey}:`, error.message); }
  }
  await UserVoucher.updateMany({ source: 'spending', status: 'available', expiresAt: { $lte: now } }, { $set: { status: 'expired' } });
}

async function deliverEmails({ now = new Date(), send = require('../utils/emailUtils').sendSpendRewardEmail, voucherId } = {}) {
  for (let count = 0; count < 100; count++) {
    const token = randomUUID();
    const job = await EmailJob.findOneAndUpdate({
      ...(voucherId ? { voucherId } : {}),
      nextAttemptAt: { $lte: now },
      $or: [{ status: 'pending' }, { status: 'sending', lockedUntil: { $lte: now } }],
    }, { $set: { status: 'sending', lockedUntil: new Date(now.getTime() + 5 * 60000), lockToken: token }, $inc: { attempts: 1 } }, { new: true, sort: { nextAttemptAt: 1 } });
    if (!job) break;
    const guard = { _id: job._id, lockToken: token };
    try {
      const voucher = await UserVoucher.findById(job.voucherId);
      const user = voucher && await User.findById(voucher.userId);
      if (!voucher || voucher.status !== 'available' || voucher.expiresAt <= now || !user?.status) {
        await EmailJob.updateOne(guard, { $set: { status: 'cancelled', lockedUntil: null } });
        continue;
      }
      if (!user.email) throw new Error('Recipient email is unavailable');
      await send(user.email, voucher);
      await EmailJob.updateOne(guard, { $set: { status: 'sent', sentAt: now, lockedUntil: null, lastError: '' } });
    } catch (error) {
      await EmailJob.updateOne(guard, { $set: { status: 'pending', lockedUntil: null,
        lastError: String(error.message).slice(0, 300),
        nextAttemptAt: new Date(now.getTime() + Math.min(3600000, 60000 * 2 ** Math.min(job.attempts, 6))),
      } });
    }
  }
}
async function processPaidBooking(bookingId, app, { now = new Date(), send, deliverEmail = true } = {}) {
  const Booking = require('../models/Booking');
  const booking = await Booking.findById(bookingId).lean();
  if (!booking?.paidAt) return null;
  const voucher = await applySpend({
    sourceKey: `booking:${booking._id}`,
    userId: booking.userId,
    occurredAt: booking.paidAt,
    sourceUpdatedAt: booking.updatedAt,
    amount: bookingSpend(booking),
  }, now, app);
  if (voucher && deliverEmail) await deliverEmails({ now, voucherId: voucher._id, ...(send ? { send } : {}) });
  return voucher;
}

function queuePaidBookingRewards(bookingIds, app) {
  const ids = (Array.isArray(bookingIds) ? bookingIds : [bookingIds]).map(String);
  // Run after the payment transaction commits. The periodic reconciler remains a durable fallback.
  setImmediate(async () => {
    const vouchers = [];
    for (const id of ids) {
      try {
        const voucher = await processPaidBooking(id, app, { deliverEmail: false });
        if (voucher) vouchers.push(voucher);
      }
      catch (error) { console.error(`[SpendRewards] booking:${id}:`, error.message); }
    }
    await Promise.all(vouchers.map(async (voucher) => {
      try { await deliverEmails({ voucherId: voucher._id }); }
      catch (error) { console.error(`[SpendRewards] email:${voucher._id}:`, error.message); }
    }));
  });
}
let running = false;
async function tick(app) {
  if (running) return;
  running = true;
  try { try { await reconcileSpending(new Date(), app); } finally { await deliverEmails(); } }
  finally { running = false; }
}
module.exports = { getProgram, saveProgram, applySpend, reconcileSpending, deliverEmails, processPaidBooking, queuePaidBookingRewards, tick };
