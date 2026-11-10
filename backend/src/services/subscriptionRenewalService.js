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

const getRenewalQuote = async (userId, subscriptionId) => {
  const quote = await validateRenewalEligibility({ userId, subscriptionId });
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
  await validateRenewalEligibility({ userId, subscriptionId: quote.subscription._id, ignoreRenewalId: renewal._id, session });
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
  const existing = await findIdempotentRenewal(userId, idempotencyKey);
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

    const debit = await walletService.debitWallet(
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
      walletTransactionId: debit.transaction._id,
    });
    await session.commitTransaction();

    await require('./membershipNotifications').notifyRenewal(activated.renewal, 'subscription', app);
    return publicRenewalResult(activated.renewal, {
      alreadyProcessed: false,
      walletBalance: debit.newBalance,
    });
  } catch (error) {
    await session.abortTransaction();
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

const createPayosRenewal = async ({ userId, subscriptionId, idempotencyKey, app = null }) => {
  const existing = await findIdempotentRenewal(userId, idempotencyKey);
  if (existing) {
    if (!['pending', 'paid'].includes(existing.status)) {
      throw businessError(
        'This renewal attempt is no longer payable. Start a new renewal.',
        'RENEWAL_ATTEMPT_CLOSED',
        409
      );
    }
    if (String(existing.subscriptionId) !== String(subscriptionId)) throw businessError('Renewal does not belong to this subscription.', 'RENEWAL_SUBSCRIPTION_MISMATCH', 409);
    if (existing.status !== 'paid') await validateRenewalEligibility({ userId, subscriptionId, ignoreRenewalId: existing._id });
    return publicRenewalResult(existing, {
      checkoutUrl: existing.payosCheckoutUrl,
      paymentLinkId: existing.payosPaymentLinkId,
      alreadyProcessed: existing.status === 'paid',
    });
  }

  const quote = await validateRenewalEligibility({ userId, subscriptionId });
  const orderCode = Number(
    `${Date.now().toString().slice(-8)}${Math.floor(Math.random() * 100)
      .toString()
      .padStart(2, '0')}`
  );
  const renewal = await SubscriptionRenewal.create({
    subscriptionId,
    userId,
    status: 'pending',
    paymentMethod: 'payos',
    orderCode,
    idempotencyKey,
    oldExpireAt: quote.currentExpireAt,
    newExpireAt: quote.newExpireAt,
    amount: quote.amount,
    packageSnapshot: quote.packageSnapshot,
    entitlementSnapshot: quote.entitlementSnapshot,
  }).catch((error) => {
    if (error?.code === 11000) {
      throw businessError(
        'A renewal payment is already pending for this subscription.',
        'RENEWAL_ALREADY_PENDING',
        409
      );
    }
    throw error;
  });

  try {
    const clientUrl = process.env.CLIENT_URL || 'http://localhost:5173';
    const paymentLink = await payos.paymentRequests.create({
      orderCode,
      amount: parseInt(quote.amount, 10),
      description: 'VALO Renew VIP',
      returnUrl:
        process.env.PAYOS_RENEWAL_RETURN_URL ||
        `${clientUrl}/customer/membership-transfers?subscriptionId=${encodeURIComponent(subscriptionId)}&renewOrderCode=${orderCode}`,
      cancelUrl:
        process.env.PAYOS_RENEWAL_CANCEL_URL ||
        `${clientUrl}/customer/membership-transfers?subscriptionId=${encodeURIComponent(subscriptionId)}&renewOrderCode=${orderCode}&cancel=true`,
      items: [{
        name: `Renew ${quote.ticketPackage.name}`,
        quantity: 1,
        price: parseInt(quote.amount, 10),
      }],
    });
    renewal.payosPaymentLinkId = paymentLink.paymentLinkId;
    renewal.payosCheckoutUrl = paymentLink.checkoutUrl;
    await renewal.save();

    return publicRenewalResult(renewal, {
      checkoutUrl: paymentLink.checkoutUrl,
      paymentLinkId: paymentLink.paymentLinkId,
      qrCode: paymentLink.qrCode,
      alreadyProcessed: false,
    });
  } catch (error) {
    renewal.status = 'failed';
    renewal.failureReason = error.message || 'Unable to create PayOS payment.';
    await renewal.save();
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
  if (renewal.status !== 'pending') {
    throw businessError('Renewal payment is not pending.', 'RENEWAL_NOT_PENDING');
  }

  const paymentInfo = await payos.paymentRequests.get(Number(orderCode));
  if (paymentInfo.status !== 'PAID') {
    if (['CANCELLED', 'FAILED'].includes(paymentInfo.status)) {
      renewal.status = paymentInfo.status === 'CANCELLED' ? 'cancelled' : 'failed';
      renewal.failureReason = paymentInfo.status;
      await renewal.save();
    }
    throw businessError('Payment not completed.', 'PAYMENT_NOT_COMPLETED');
  }

  const quote = await validateRenewalEligibility({
    userId,
    subscriptionId: renewal.subscriptionId,
    ignoreRenewalId: renewal._id,
  });
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
    await require('./membershipNotifications').notifyRenewal(activated.renewal, 'subscription', app);
    return publicRenewalResult(activated.renewal, { alreadyProcessed: false });
  } catch (error) {
    await session.abortTransaction();
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
