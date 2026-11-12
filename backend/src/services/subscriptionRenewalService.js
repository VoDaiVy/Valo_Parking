const { assertNoMembershipBookingConflict } = require('./membershipBookingConflictService');
const { lockOwner } = require('./legacyEntitlementCompatibilityService');
const { ensurePaymentLink, generateOrderCode } = require('./payosOrderService');
const { assertPaymentMatches } = require('./ticketPackageTerms');
const mongoose = require('mongoose');
const payos = require('../config/payos');
const Subscription = require('../models/Subscription');
const SubscriptionRenewal = require('../models/SubscriptionRenewal');
const Slot = require('../models/Slot');
const User = require('../models/User');
const walletService = require('./walletService');
const {
  validateRenewalEligibility,
  toPublicQuote,
  businessError,
} = require('./subscriptionEligibilityService');

const assertRenewalBookingAvailability = async (quote, session = null) => {
  for (const slot of quote.selectedSlots) {
    await assertNoMembershipBookingConflict({ floorId: slot.floorId, slotCode: slot.slotCode,
      validFrom: quote.currentExpireAt, expireAt: quote.newExpireAt, session });
  }
};

const getRenewalQuote = async (userId, subscriptionId) => {
  const quote = await validateRenewalEligibility({ userId, subscriptionId });
  await assertRenewalBookingAvailability(quote);
  return toPublicQuote(quote);
};

const findIdempotentRenewal = async (userId, idempotencyKey) => {
  if (!idempotencyKey) return null;
  return SubscriptionRenewal.findOne({ userId, idempotencyKey });
};

const publicRenewalResult = (renewal, extra = {}) => ({
  renewalId: renewal._id,
  subscriptionId: renewal.subscriptionId,
  status: renewal.status,
  paymentMethod: renewal.paymentMethod,
  amount: renewal.amount,
  oldExpireAt: renewal.oldExpireAt,
  newExpireAt: renewal.newExpireAt,
  orderCode: renewal.orderCode || null,
  ...extra,
});

const slotOwnershipFilter = (quote, userId) => ({
  $and: [
    {
      $or: quote.selectedSlots.map((slot) => ({
        floorID: slot.floorId,
        slotNumber: slot.slotCode,
      })),
    },
    {
      $or: [
        { reservedBySubscriptionId: quote.subscription._id },
        { reservedBySubscriptionId: null },
        { reservedBySubscriptionId: { $exists: false } },
      ],
    },
  ],
  reservedFor: userId,
});

const activateRenewalInSession = async ({
  userId,
  renewal,
  quote,
  session,
  walletTransactionId = null,
}) => {
  await validateRenewalEligibility({ userId, subscriptionId: quote.subscription._id, ignoreRenewalId: renewal._id, now: renewal.createdAt, quotedTerms: renewal.packageSnapshot, session });
  await lockOwner(userId, session);
  await assertRenewalBookingAvailability(quote, session);
  const subscription = await Subscription.findOneAndUpdate(
    {
      _id: quote.subscription._id,
      user: userId,
      status: 'active',
      paymentStatus: 'paid',
      expireAt: quote.currentExpireAt,
    },
    {
      $set: {
        expireAt: quote.newExpireAt,
        lastRenewedAt: new Date(),
        expireWarningSent: false,
      },
      $inc: { renewalCount: 1 },
    },
    { new: true, session }
  );
  if (!subscription) {
    throw businessError(
      'Subscription changed while renewal was processing. Please retry.',
      'RENEWAL_STATE_CHANGED',
      409
    );
  }

  const slotResult = await Slot.updateMany(
    slotOwnershipFilter(quote, userId),
    {
      $set: {
        reservedFor: userId,
        reservedBySubscriptionId: subscription._id,
        reservedUntil: quote.newExpireAt,
      },
    },
    { session }
  );
  if (slotResult.matchedCount !== quote.selectedSlots.length) {
    throw businessError(
      'One or more reserved slots changed during renewal.',
      'SLOT_OWNERSHIP_CHANGED',
      409
    );
  }

  await User.updateOne(
    { _id: userId },
    {
      $set: {
        'membership.isVip': true,
        'membership.packageId': subscription.ticketPackage,
        'membership.expireAt': quote.newExpireAt,
      },
    },
    { session }
  );

  renewal.status = 'paid';
  renewal.notificationPending = true;
  renewal.oldExpireAt = quote.currentExpireAt;
  renewal.newExpireAt = quote.newExpireAt;
  renewal.walletTransactionId = walletTransactionId || renewal.walletTransactionId;
  renewal.paidAt = new Date();
  await renewal.save({ session });

  return { renewal, subscription };
};

const renewWithWallet = async ({ userId, subscriptionId, idempotencyKey, app = null }) => {
  if (typeof idempotencyKey !== 'string' || idempotencyKey.length < 16 || idempotencyKey.length > 128) throw businessError('A stable request key of 16-128 characters is required.', 'INVALID_REQUEST_KEY');
  const existing = await findIdempotentRenewal(userId, idempotencyKey);
  if (existing && (String(existing.subscriptionId) !== String(subscriptionId) || existing.paymentMethod !== 'wallet')) throw businessError('This request key belongs to another renewal operation.', 'RENEWAL_CONTEXT_MISMATCH', 409);
  if (existing?.status === 'paid') {
    return publicRenewalResult(existing, { alreadyProcessed: true });
  }
  if (existing) {
    throw businessError(
      'This renewal request is already being processed.',
      'RENEWAL_REQUEST_EXISTS',
      409
    );
  }

  let quote = await validateRenewalEligibility({ userId, subscriptionId });
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    quote = await validateRenewalEligibility({ userId, subscriptionId, session });
    await assertRenewalBookingAvailability(quote, session);
    const created = await SubscriptionRenewal.create(
      [{
        subscriptionId,
        userId,
        status: 'pending',
        paymentMethod: 'wallet',
        idempotencyKey,
        oldExpireAt: quote.currentExpireAt,
        newExpireAt: quote.newExpireAt,
        amount: quote.amount,
        packageSnapshot: quote.packageSnapshot,
        entitlementSnapshot: quote.entitlementSnapshot,
      }],
      { session }
    );
    const renewal = created[0];

    const debit = quote.amount === 0 ? { transaction: null, newBalance: undefined } : await walletService.debitWallet(
      userId,
      quote.amount,
      `Renew VIP package - ${quote.ticketPackage.name}`,
      {
        refSource: 'subscription_renewal',
        refSourceId: renewal._id,
        session,
      }
    );

    const activated = await activateRenewalInSession({
      userId,
      renewal,
      quote,
      session,
      walletTransactionId: debit.transaction?._id,
    });
    await session.commitTransaction();

    await require('./membershipNotifications').notifyRenewal(activated.renewal, 'subscription', app).catch((error) => console.error('Renewal notification deferred:', error.message));
    return publicRenewalResult(activated.renewal, {
      alreadyProcessed: false,
      walletBalance: debit.newBalance,
    });
  } catch (error) {
    if (session.inTransaction()) await session.abortTransaction();
    if (error?.code === 11000) {
      const duplicate = await findIdempotentRenewal(userId, idempotencyKey);
      if (duplicate?.status === 'paid') {
        return publicRenewalResult(duplicate, { alreadyProcessed: true });
      }
      throw businessError('Duplicate renewal request.', 'DUPLICATE_RENEWAL', 409);
    }
    throw error;
  } finally {
    session.endSession();
  }
};

const createPayosRenewal = async ({ userId, subscriptionId, idempotencyKey }) => {
  if (typeof idempotencyKey !== 'string' || idempotencyKey.length < 16 || idempotencyKey.length > 128) throw businessError('A stable request key of 16-128 characters is required.', 'INVALID_REQUEST_KEY');
  let renewal = await SubscriptionRenewal.findOne({ userId, idempotencyKey });
  if (renewal && (String(renewal.subscriptionId) !== String(subscriptionId) || renewal.paymentMethod !== 'payos')) throw businessError('This request key belongs to another renewal operation.', 'RENEWAL_CONTEXT_MISMATCH', 409);
  if (renewal && !['pending', 'paid'].includes(renewal.status)) throw businessError('This renewal attempt is closed. Start a new renewal.', 'RENEWAL_ATTEMPT_CLOSED', 409);
  if (!renewal) {
    const quote = await validateRenewalEligibility({ userId, subscriptionId });
    await assertRenewalBookingAvailability(quote);
    if (quote.amount <= 0) throw businessError('Use Wallet to activate a zero-price renewal.', 'ZERO_PRICE_USE_WALLET');
    const transaction = await mongoose.startSession();
    try { await transaction.withTransaction(async () => {
      await assertRenewalBookingAvailability(quote, transaction);
      const locked = await Subscription.updateOne({ _id: subscriptionId, user: userId, status: 'active', expireAt: quote.currentExpireAt }, { $inc: { __v: 1 } }, { session: transaction });
      if (!locked.matchedCount) throw businessError('Membership changed. Refresh before creating a payment.', 'RENEWAL_STATE_CHANGED', 409);
      [renewal] = await SubscriptionRenewal.create([{
      subscriptionId, userId, status: 'pending', paymentMethod: 'payos', idempotencyKey,
      orderCode: generateOrderCode('subscriptionRenewal'),
      oldExpireAt: quote.currentExpireAt, newExpireAt: quote.newExpireAt, amount: quote.amount,
      packageSnapshot: quote.packageSnapshot, entitlementSnapshot: quote.entitlementSnapshot,
      }], { session: transaction });
    }); } finally { await transaction.endSession(); }
  }
  if (renewal.status === 'paid' || renewal.payosCheckoutUrl) return publicRenewalResult(renewal, { checkoutUrl: renewal.payosCheckoutUrl, paymentLinkId: renewal.payosPaymentLinkId, alreadyProcessed: renewal.status === 'paid' });
  const clientUrl = (process.env.CLIENT_URL || 'http://localhost:5173').replace(/\/+$/, '');
  try {
    const payment = await ensurePaymentLink({
      orderCode: renewal.orderCode, amount: renewal.amount, description: 'VALO Renew Space',
      returnUrl: process.env.PAYOS_RENEWAL_RETURN_URL || `${clientUrl}/customer/membership-transfers?subscriptionId=${encodeURIComponent(subscriptionId)}&renewOrderCode=${renewal.orderCode}`,
      cancelUrl: process.env.PAYOS_RENEWAL_CANCEL_URL || `${clientUrl}/customer/membership-transfers?subscriptionId=${encodeURIComponent(subscriptionId)}&renewOrderCode=${renewal.orderCode}&cancel=true`,
    });
    await SubscriptionRenewal.updateOne({ _id: renewal._id }, { $set: { payosPaymentLinkId: payment.paymentLinkId, payosCheckoutUrl: payment.checkoutUrl, failureReason: '' } });
    return publicRenewalResult(renewal, { checkoutUrl: payment.checkoutUrl, paymentLinkId: payment.paymentLinkId, qrCode: payment.qrCode, alreadyProcessed: false });
  } catch (error) {
    // A timeout is not proof of failure. Retain this order and its pending lock.
    await SubscriptionRenewal.updateOne({ _id: renewal._id, status: 'pending' }, { $set: { failureReason: error.message } });
    throw error;
  }
};

const verifyPayosRenewal = async ({ userId, orderCode, app = null }) => {
  const renewal = await SubscriptionRenewal.findOne({
    userId,
    orderCode: Number(orderCode),
    paymentMethod: 'payos',
  });
  if (!renewal) {
    throw businessError('Renewal payment not found.', 'RENEWAL_NOT_FOUND', 404);
  }
  if (renewal.status === 'paid') {
    return publicRenewalResult(renewal, { alreadyProcessed: true });
  }
  if (!['pending', 'failed'].includes(renewal.status)) {
    throw businessError('Renewal payment is not pending.', 'RENEWAL_NOT_PENDING');
  }

  const paymentInfo = await payos.paymentRequests.get(Number(orderCode));
  if (paymentInfo.status !== 'PAID') {
    if (['CANCELLED', 'FAILED', 'EXPIRED'].includes(paymentInfo.status)) {
      renewal.status = 'cancelled';
      renewal.failureReason = paymentInfo.status;
      await renewal.save();
    }
    throw businessError('Payment not completed.', ['CANCELLED', 'FAILED', 'EXPIRED'].includes(paymentInfo.status) ? 'PAYMENT_ORDER_CLOSED' : 'PAYMENT_NOT_COMPLETED');
  }

  assertPaymentMatches(paymentInfo, orderCode, renewal.amount);
  await SubscriptionRenewal.updateOne({ _id: renewal._id }, { $set: { paymentConfirmedAt: new Date() } });
  let quote;
  try {
    quote = await validateRenewalEligibility({
    userId,
    subscriptionId: renewal.subscriptionId,
    ignoreRenewalId: renewal._id,
    now: renewal.createdAt, quotedTerms: renewal.packageSnapshot,
  });
  } catch (error) {
    await SubscriptionRenewal.updateOne({ _id: renewal._id }, { $set: { failureReason: error.message } });
    throw businessError('Payment is confirmed, but this renewal needs support reconciliation. Keep the renewal reference.', 'PAID_RENEWAL_RECONCILIATION', 409);
  }
  if (new Date(quote.currentExpireAt).getTime() !== new Date(renewal.oldExpireAt).getTime()) {
    throw businessError('The paid renewal needs reconciliation because membership dates changed.', 'PAID_RENEWAL_RECONCILIATION', 409);
  }
  // Execute the terms captured for this payment, never a fresh catalog quote.
  quote.newExpireAt = renewal.newExpireAt;
  quote.amount = renewal.amount;
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const sessionRenewal = await SubscriptionRenewal.findById(renewal._id).session(session);
    if (sessionRenewal.status === 'paid') {
      await session.commitTransaction();
      return publicRenewalResult(sessionRenewal, { alreadyProcessed: true });
    }
    const activated = await activateRenewalInSession({
      userId,
      renewal: sessionRenewal,
      quote,
      session,
    });
    await session.commitTransaction();
    await require('./membershipNotifications').notifyRenewal(activated.renewal, 'subscription', app).catch((error) => console.error('Renewal notification deferred:', error.message));
    return publicRenewalResult(activated.renewal, { alreadyProcessed: false });
  } catch (error) {
    if (session.inTransaction()) await session.abortTransaction();
    await SubscriptionRenewal.updateOne({ _id: renewal._id, status: { $ne: 'paid' } }, { $set: { failureReason: error.message } });
    if (['MEMBERSHIP_BOOKING_CONFLICT', 'MEMBERSHIP_HOLD_CONFLICT'].includes(error.code)) {
      throw businessError('Payment is confirmed, but the renewal interval conflicts with a booking or hold. Do not pay again; keep the renewal reference for support reconciliation.', 'PAID_RENEWAL_RECONCILIATION', 409);
    }
    throw error;
  } finally {
    session.endSession();
  }
};

module.exports = {
  getRenewalQuote,
  renewWithWallet,
  createPayosRenewal,
  verifyPayosRenewal,
};
