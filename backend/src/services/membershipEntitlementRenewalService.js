const { renewalWindowDays: getRenewalWindowDays, isInRenewalWindow } = require('../utils/membershipRenewalWindow');
const mongoose = require('mongoose');
const payos = require('../config/payos');
const MembershipEntitlementRenewal = require('../models/MembershipEntitlementRenewal');
const MembershipSlotEntitlement = require('../models/MembershipSlotEntitlement');
const Slot = require('../models/Slot');
const Subscription = require('../models/Subscription');
const Vehicle = require('../models/Vehicle');
const { validateEntitlementSpace } = require('./membershipSpaceValidationService');
const walletService = require('./walletService');
const { recomputeUserMembership } = require('./membershipProjectionService');
const {
  businessError,
  _private: { addPackageDuration },
} = require('./subscriptionEligibilityService');

const DAY_MS = 24 * 60 * 60 * 1000;

const getQuote = async (userId, entitlementId, options = {}) => {
  const now = options.now || new Date();
  const entitlement = await MembershipSlotEntitlement.findOne({
    _id: entitlementId,
    ownerId: userId,
    status: 'active',
    expireAt: { $gt: now },
  }).populate('packageId');
  if (!entitlement) {
    throw businessError('Active membership space not found.', 'ENTITLEMENT_NOT_FOUND', 404);
  }
  await validateEntitlementSpace(entitlement, userId, { session: options.session });
  const pkg = entitlement.packageId;
  if (!pkg || pkg.isRenewable === false || !['monthly', 'yearly'].includes(pkg.type)) {
    throw businessError('This membership space cannot be renewed.', 'PACKAGE_NOT_RENEWABLE');
  }
  const daysUntilExpiration = Math.ceil(
    (new Date(entitlement.expireAt).getTime() - now.getTime()) / DAY_MS
  );
  const renewalWindowDays = getRenewalWindowDays(pkg);
  if (!isInRenewalWindow(entitlement.expireAt, pkg, now)) {
    throw businessError(
      `Renewal opens ${renewalWindowDays} days before expiration.`,
      'RENEWAL_WINDOW_NOT_OPEN'
    );
  }
  const approvedVehicles = await Vehicle.countDocuments({
    owner: userId,
    status: 'approved',
  });
  const activeEntitlements = await MembershipSlotEntitlement.countDocuments({
    ownerId: userId,
    status: { $in: ['active', 'transfer_locked'] },
    expireAt: { $gt: now },
  });
  if (activeEntitlements > Math.min(3, approvedVehicles)) {
    throw businessError(
      'Approved vehicle capacity is lower than the number of active spaces.',
      'INSUFFICIENT_ELIGIBLE_VEHICLES'
    );
  }
  return {
    entitlement,
    entitlementId: entitlement._id,
    sourceSubscriptionId: entitlement.sourceSubscriptionId,
    oldExpireAt: entitlement.expireAt,
    currentExpireAt: entitlement.expireAt,
    newExpireAt: addPackageDuration(entitlement.expireAt, pkg.type),
    amount: Number(pkg.price || 0),
    daysUntilExpiration,
    renewalWindowDays,
    retainedSlots: [{
      entitlementId: entitlement._id,
      floorId: entitlement.floorId,
      slotCode: entitlement.slotCode,
    }],
    package: {
      id: pkg._id,
      name: pkg.name,
      type: pkg.type,
      unitPrice: Number(pkg.price || 0),
    },
  };
};

const publicResult = (renewal, extra = {}) => ({
  renewalId: renewal._id,
  entitlementId: renewal.entitlementId,
  status: renewal.status,
  paymentMethod: renewal.paymentMethod,
  amount: renewal.amount,
  oldExpireAt: renewal.oldExpireAt,
  newExpireAt: renewal.newExpireAt,
  orderCode: renewal.orderCode || null,
  ...extra,
});

const activateInTransaction = async ({ renewal, quote, session, walletTransactionId }) => {
  await validateEntitlementSpace(quote.entitlement, renewal.userId, { session });
  const entitlement = await MembershipSlotEntitlement.findOneAndUpdate(
    {
      _id: quote.entitlement._id,
      ownerId: renewal.userId,
      status: 'active',
      expireAt: quote.oldExpireAt,
    },
    {
      $set: {
        expireAt: quote.newExpireAt,
        expireWarningSentAt: null,
        unitAmount: quote.amount,
      },
    },
    { new: true, session }
  );
  if (!entitlement) {
    throw businessError('Membership space changed during renewal.', 'ENTITLEMENT_CHANGED', 409);
  }
  const slotResult = await Slot.updateOne(
    {
      _id: entitlement.slotId,
      reservedByEntitlementId: entitlement._id,
      reservedFor: renewal.userId,
    },
    { $set: { reservedUntil: quote.newExpireAt } },
    { session }
  );
  if (slotResult.matchedCount !== 1) {
    throw businessError('Reserved space ownership changed.', 'SLOT_OWNERSHIP_CHANGED', 409);
  }
  await Subscription.updateOne(
    { _id: entitlement.sourceSubscriptionId },
    {
      $set: { status: 'active', paymentStatus: 'paid' },
      $max: { expireAt: quote.newExpireAt },
    },
    { session }
  );
  renewal.status = 'paid';
  renewal.notificationPending = true;
  renewal.paidAt = new Date();
  renewal.walletTransactionId = walletTransactionId || null;
  await renewal.save({ session });
  await recomputeUserMembership(renewal.userId, { session, rotateQr: true });
  return renewal;
};

const renewWithWallet = async ({ userId, entitlementId, idempotencyKey, app = null }) => {
  const existing = await MembershipEntitlementRenewal.findOne({ userId, idempotencyKey });
  if (existing?.status === 'paid') return publicResult(existing, { alreadyProcessed: true });
  if (existing) throw businessError('Renewal request already exists.', 'RENEWAL_EXISTS', 409);
  const quote = await getQuote(userId, entitlementId);
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    await validateEntitlementSpace(quote.entitlement, userId, { session });
    const [renewal] = await MembershipEntitlementRenewal.create(
      [{
        entitlementId,
        userId,
        sourceSubscriptionId: quote.sourceSubscriptionId,
        status: 'pending',
        paymentMethod: 'wallet',
        idempotencyKey,
        oldExpireAt: quote.oldExpireAt,
        newExpireAt: quote.newExpireAt,
        amount: quote.amount,
        packageSnapshot: quote.package,
      }],
      { session }
    );
    const debit = await walletService.debitWallet(
      userId,
      quote.amount,
      `Renew VIP space ${quote.entitlement.slotCode}`,
      {
        refSource: 'membership_entitlement_renewal',
        refSourceId: renewal._id,
        session,
      }
    );
    await activateInTransaction({
      renewal,
      quote,
      session,
      walletTransactionId: debit.transaction._id,
    });
    await session.commitTransaction();
    await require('./membershipNotifications').notifyRenewal(renewal, 'entitlement', app);
    return publicResult(renewal, {
      alreadyProcessed: false,
      walletBalance: debit.newBalance,
    });
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    await session.endSession();
  }
};

const createPayosRenewal = async ({ userId, entitlementId, idempotencyKey, app = null }) => {
  const existing = await MembershipEntitlementRenewal.findOne({ userId, idempotencyKey });
  if (existing) {
    if (String(existing.entitlementId) !== String(entitlementId)) throw businessError('Renewal request belongs to another membership.', 'RENEWAL_ENTITLEMENT_MISMATCH', 409);
    if (!['pending', 'paid'].includes(existing.status)) throw businessError('This renewal attempt is no longer payable. Start a new renewal.', 'RENEWAL_ATTEMPT_CLOSED', 409);
    if (existing.status !== 'paid') {
      await getQuote(userId, entitlementId);
    }
    return publicResult(existing, {
      checkoutUrl: existing.payosCheckoutUrl,
      alreadyProcessed: existing.status === 'paid',
    });
  }
  const quote = await getQuote(userId, entitlementId);
  const orderCode = Number(
    `${Date.now().toString().slice(-8)}${Math.floor(Math.random() * 100)
      .toString()
      .padStart(2, '0')}`
  );
  const renewal = await MembershipEntitlementRenewal.create({
    entitlementId,
    userId,
    sourceSubscriptionId: quote.sourceSubscriptionId,
    status: 'pending',
    paymentMethod: 'payos',
    orderCode,
    idempotencyKey,
    oldExpireAt: quote.oldExpireAt,
    newExpireAt: quote.newExpireAt,
    amount: quote.amount,
    packageSnapshot: quote.package,
  });
  try {
    const clientUrl = process.env.CLIENT_URL || 'http://localhost:5173';
    const payment = await payos.paymentRequests.create({
      orderCode,
      amount: parseInt(quote.amount, 10),
      description: 'VALO Renew Space',
      returnUrl: `${clientUrl}/customer/membership-transfers?entitlementId=${encodeURIComponent(entitlementId)}&entitlementRenewOrderCode=${orderCode}`,
      cancelUrl: `${clientUrl}/customer/membership-transfers?entitlementId=${encodeURIComponent(entitlementId)}&entitlementRenewOrderCode=${orderCode}&cancel=true`,
      items: [{
        name: `Renew ${quote.entitlement.slotCode}`,
        quantity: 1,
        price: parseInt(quote.amount, 10),
      }],
    });
    renewal.payosPaymentLinkId = payment.paymentLinkId;
    renewal.payosCheckoutUrl = payment.checkoutUrl;
    await renewal.save();
    return publicResult(renewal, {
      checkoutUrl: payment.checkoutUrl,
      qrCode: payment.qrCode,
      alreadyProcessed: false,
    });
  } catch (error) {
    renewal.status = 'failed';
    renewal.failureReason = error.message;
    await renewal.save();
    throw error;
  }
};

const verifyPayosRenewal = async ({ userId, orderCode, app = null }) => {
  const renewal = await MembershipEntitlementRenewal.findOne({
    userId,
    orderCode: Number(orderCode),
  });
  if (!renewal) throw businessError('Renewal not found.', 'RENEWAL_NOT_FOUND', 404);
  if (renewal.status === 'paid') return publicResult(renewal, { alreadyProcessed: true });
  const payment = await payos.paymentRequests.get(Number(orderCode));
  if (payment.status !== 'PAID') {
    if (['CANCELLED', 'FAILED'].includes(payment.status)) {
      renewal.status = payment.status === 'CANCELLED' ? 'cancelled' : 'failed';
      renewal.failureReason = payment.status;
      await renewal.save();
    }
    throw businessError('Payment not completed.', 'PAYMENT_NOT_COMPLETED');
  }
  const quote = await getQuote(userId, renewal.entitlementId);
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const current = await MembershipEntitlementRenewal.findById(renewal._id).session(session);
    if (current.status === 'paid') {
      await session.commitTransaction();
      return publicResult(current, { alreadyProcessed: true });
    }
    await activateInTransaction({ renewal: current, quote, session });
    await session.commitTransaction();
    await require('./membershipNotifications').notifyRenewal(current, 'entitlement', app);
    return publicResult(current, { alreadyProcessed: false });
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    await session.endSession();
  }
};

module.exports = {
  getQuote,
  renewWithWallet,
  createPayosRenewal,
  verifyPayosRenewal,
};
