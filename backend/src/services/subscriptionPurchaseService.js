const mongoose = require('mongoose');
const Subscription = require('../models/Subscription');
const TicketPackage = require('../models/TicketPackage');
const { ensurePaymentLink, generateOrderCode } = require('./payosOrderService');
const wallet = require('./walletService');
const { lockVehicle } = require('./vehicleEntitlementService');
const { snapshotPackage, addConfiguredDuration, salesAvailability } = require('./ticketPackageTerms');
const { validateNewSubscriptionEligibility } = require('./subscriptionEligibilityService');
const { activateSubscriptionEntitlements } = require('./membershipEntitlementService');
const { buildSubscriptionPaymentUrls } = require('../utils/subscriptionPaymentUrls');

const fail = (message, statusCode = 409) => Object.assign(new Error(message), { statusCode });
const result = (purchase) => ({ subscriptionId: purchase._id, orderCode: purchase.orderCode,
  amount: purchase.amount, checkoutUrl: purchase.payosCheckoutUrl, paymentLinkId: purchase.payosPaymentLinkId,
  status: purchase.status, expireAt: purchase.status === 'active' ? purchase.expireAt : null });

async function purchase({ userId, packageId, slots, idempotencyKey, paymentMethod }) {
  if (typeof idempotencyKey !== 'string' || idempotencyKey.length < 16 || idempotencyKey.length > 128)
    throw fail('A stable purchase idempotency key (16–128 characters) is required.', 400);
  const indexes = await Subscription.collection.indexes();
  if (!['unique_package_purchase_request', 'unique_bound_purchase_order'].every(
    (name) => indexes.some((index) => index.name === name && index.unique)))
    throw fail('Package purchase indexes must be deployed before purchases are enabled.', 503);
  if (!Array.isArray(slots) || !slots.length || slots.length > 10 || !mongoose.isValidObjectId(packageId)
    || slots.some((slot) => !slot || !mongoose.isValidObjectId(slot.floorId) || !mongoose.isValidObjectId(slot.vehicleId) || typeof slot.slotCode !== 'string' || !slot.slotCode.trim() || slot.slotCode.length > 64)) throw fail('Select a valid package and at least one reserved space.', 400);
  const requestSlots = slots.map((slot) => `${slot.floorId}:${String(slot.slotCode).trim().toUpperCase()}:${slot.vehicleId}`).sort();
  let order;
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      order = await Subscription.findOne({ user: userId, idempotencyKey }).session(session);
      // Availability gates new orders only. Durable PayOS retries retain the
      // original amount and benefits even if sales have since ended.
      if (order) {
        const stored = order.slots.map((slot) => `${slot.floorId}:${slot.slotCode}:${slot.vehicleId}`).sort();
        if (String(order.ticketPackage) !== String(packageId) || order.paymentMethod !== paymentMethod
          || JSON.stringify(stored) !== JSON.stringify(requestSlots)) throw fail('This request key belongs to a different purchase.');
        return;
      }
      const pkg = await TicketPackage.findOneAndUpdate({ _id: packageId, isActive: true, type: { $in: ['hourly', 'monthly', 'yearly'] } },
        { $inc: { purchaseRevision: 1 } }, { new: true, session, timestamps: false });
      if (!pkg) throw fail('This package is unavailable.', 400);
      const availability = salesAvailability(pkg);
      if (!availability.available) throw Object.assign(fail(availability.message), { code: 'PACKAGE_SALES_UNAVAILABLE' });
      if (!pkg.service) throw fail('This legacy package must be replaced with an explicitly configured service before new sales.');
      const eligibility = await validateNewSubscriptionEligibility({ userId, ticketPackage: pkg, slots, session });
      const selected = eligibility.normalizedSlots;
      if (selected.some((slot) => !mongoose.isValidObjectId(slot.vehicleId))
        || new Set(selected.map((slot) => String(slot.vehicleId))).size !== selected.length)
        throw fail('Choose a different approved vehicle for each reserved space.', 400);
      const now = new Date();
      if (!salesAvailability(pkg, now).available) throw Object.assign(fail(salesAvailability(pkg, now).message), { code: 'PACKAGE_SALES_UNAVAILABLE' });
      const expireAt = addConfiguredDuration(now, pkg);
      const purchaseId = new mongoose.Types.ObjectId();
      for (const slot of [...selected].sort((a, b) => String(a.vehicleId).localeCompare(String(b.vehicleId)))) {
        await lockVehicle({ vehicleId: slot.vehicleId, ownerId: userId, from: now, until: expireAt, session });
      }
      const amount = Number(pkg.price) * selected.length;
      if (paymentMethod === 'payos' && amount === 0) throw fail('Use Wallet to confirm a zero-price package without an external payment.', 400);
      if (!Number.isSafeInteger(amount) || amount < 0) throw fail('The package price must be a whole VND amount.', 400);
      [order] = await Subscription.create([{
        _id: purchaseId, user: userId, ticketPackage: pkg._id, slots: selected,
        packageSnapshot: snapshotPackage(pkg), bindingVersion: 1, paymentMethod, idempotencyKey,
        orderCode: generateOrderCode('purchase'), amount, validFrom: now, expireAt,
        status: 'pending', paymentStatus: 'pending',
      }], { session });
      if (paymentMethod === 'wallet') {
        if (amount > 0) await wallet.debitWallet(userId, amount, `Buy package ${pkg.name}`, {
          refSource: 'subscription', refSourceId: String(order._id), idempotencyKey: `package:${order._id}`, session,
        });
        order.status = 'active'; order.paymentStatus = 'paid'; order.activatedAt = now;
        await order.save({ session });
        await activateSubscriptionEntitlements(order, { session });
      }
    });
  } catch (error) {
    if (error.code === 11000) throw fail('This purchase is already being processed. Retry the same request.');
    throw error;
  } finally { await session.endSession(); }
  if (order.paymentStatus === 'paid') return result(order);
  if (order.status !== 'pending') throw Object.assign(fail('This purchase is closed. Start a new purchase.'), { code: 'PURCHASE_ATTEMPT_CLOSED' });
  if (paymentMethod === 'wallet' || order.payosCheckoutUrl) return result(order);
  const urls = buildSubscriptionPaymentUrls(order.orderCode);
  // The order is durable before the provider can accept payment. A provider
  // timeout leaves it reconcilable by orderCode; retry reuses that identity.
  const link = await ensurePaymentLink({ orderCode: order.orderCode, amount: order.amount,
      description: 'VALO Package', returnUrl: urls.returnUrl, cancelUrl: urls.cancelUrl });
  order.payosCheckoutUrl = link.checkoutUrl;
  order.payosPaymentLinkId = link.paymentLinkId || link.id;
  await Subscription.updateOne({ _id: order._id }, { $set: { payosCheckoutUrl: order.payosCheckoutUrl, payosPaymentLinkId: order.payosPaymentLinkId } });
  return { ...result(order), qrCode: link.qrCode };
}

module.exports = { purchase };
