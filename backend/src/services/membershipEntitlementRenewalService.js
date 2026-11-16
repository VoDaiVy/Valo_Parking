const { assertNoMembershipBookingConflict } = require('./membershipBookingConflictService');
const { lockOwner } = require('./legacyEntitlementCompatibilityService');
const { ensurePaymentLink, generateOrderCode } = require('./payosOrderService');
const { snapshotPackage } = require('./ticketPackageTerms');
const { lockVehicle } = require('./vehicleEntitlementService');
const { assertPaymentMatches } = require('./ticketPackageTerms');
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
  }).populate('packageId').session(options.session || null);
  if (!entitlement) {
    throw businessError('Active membership space not found.', 'ENTITLEMENT_NOT_FOUND', 404);
  }
  await validateEntitlementSpace(entitlement, userId, { session: options.session });
  if (entitlement.vehicleId && !await Vehicle.exists({ _id: entitlement.vehicleId, owner: userId, status: 'approved' }).session(options.session || null)) throw businessError('The bound vehicle must still be approved and owned by this account.', 'VEHICLE_INELIGIBLE', 409);
  const terms = options.packageSnapshot || entitlement.packageSnapshot;
  const pkg = terms ? { ...terms, _id: terms.id, price: terms.unitPrice } : entitlement.packageId;
  const pending = await MembershipEntitlementRenewal.exists({ entitlementId, status: 'pending', ...(options.ignoreRenewalId ? { _id: { $ne: options.ignoreRenewalId } } : {}) }).session(options.session || null);
  if (!options.ignoreRenewalId && await require('../models/MembershipEntitlementTransfer').exists({ entitlementId, status: { $in: ['PENDING_RECIPIENT', 'PENDING_ADMIN', 'LISTED', 'AWAITING_PAYMENT'] } }).session(options.session || null)) throw businessError('Close the open transfer before renewing this space.', 'TRANSFER_OPEN', 409);
  if (pending) throw businessError('A renewal payment is already pending for this space.', 'RENEWAL_ALREADY_PENDING', 409);
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
  if (activeEntitlements > approvedVehicles) {
    throw businessError(
      'Approved vehicle capacity is lower than the number of active spaces.',
      'INSUFFICIENT_ELIGIBLE_VEHICLES'
    );
  }
  const newExpireAt = addPackageDuration(entitlement.expireAt, pkg);
  // Only the added half-open interval is new inventory. The current entitlement
  // and its original coverage must not conflict with their own renewal.
  await assertNoMembershipBookingConflict({ floorId: entitlement.floorId, slotCode: entitlement.slotCode,
    validFrom: entitlement.expireAt, expireAt: newExpireAt, session: options.session || null });
  return {
    entitlement,
    entitlementId: entitlement._id,
    subscriptionId: entitlement.sourceSubscriptionId,
    quoteId: require('crypto').createHash('sha256').update(JSON.stringify([String(entitlement._id), entitlement.expireAt, pkg.price, pkg.type])).digest('hex'),
    quoteExpiresAt: new Date(new Date(now).getTime() + 5 * 60000),
    unitPrice: Number(pkg.price || 0), eligibleVehicleCount: approvedVehicles,
    sourceSubscriptionId: entitlement.sourceSubscriptionId,
    oldExpireAt: entitlement.expireAt,
    currentExpireAt: entitlement.expireAt,
    newExpireAt,
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
      ...snapshotPackage(pkg),
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
  await lockOwner(renewal.userId, session);
  await validateEntitlementSpace(quote.entitlement, renewal.userId, { session });
  await assertNoMembershipBookingConflict({ floorId: quote.entitlement.floorId, slotCode: quote.entitlement.slotCode,
    validFrom: quote.oldExpireAt, expireAt: quote.newExpireAt, session });
  if (quote.entitlement.vehicleId) await lockVehicle({
    vehicleId: quote.entitlement.vehicleId, ownerId: renewal.userId,
    from: quote.oldExpireAt, until: quote.newExpireAt,
    excludeEntitlementId: quote.entitlement._id, excludeSubscriptionId: quote.entitlement.sourceSubscriptionId, session,
  });
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
  if (typeof idempotencyKey !== 'string' || idempotencyKey.length < 16 || idempotencyKey.length > 128) throw businessError('A stable request key of 16-128 characters is required.', 'INVALID_REQUEST_KEY');
  const existing = await MembershipEntitlementRenewal.findOne({ userId, idempotencyKey });
  if (existing && (String(existing.entitlementId) !== String(entitlementId) || existing.paymentMethod !== 'wallet')) throw businessError('This request key belongs to another renewal operation.', 'RENEWAL_CONTEXT_MISMATCH', 409);
  if (existing?.status === 'paid') {
    if (String(existing.entitlementId) !== String(entitlementId)) {
      throw businessError('Renewal request belongs to another membership.', 'RENEWAL_ENTITLEMENT_MISMATCH', 409);
    }
    if (String(existing.userId) !== String(userId) || existing.paymentMethod !== 'wallet') {
      throw businessError('Renewal request does not match this operation.', 'RENEWAL_CONTEXT_MISMATCH', 409);
    }
    return publicResult(existing, { alreadyProcessed: true });
  }
  if (existing) throw businessError('Renewal request already exists.', 'RENEWAL_EXISTS', 409);
  let quote = await getQuote(userId, entitlementId);
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    quote = await getQuote(userId, entitlementId, { session });
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
    const debit = quote.amount === 0 ? { transaction: null, newBalance: undefined } : await walletService.debitWallet(
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
      walletTransactionId: debit.transaction?._id,
    });
    await session.commitTransaction();
    await require('./membershipNotifications').notifyRenewal(renewal, 'entitlement', app).catch((error) => console.error('Renewal notification deferred:', error.message));
    return publicResult(renewal, {
      alreadyProcessed: false,
      walletBalance: debit.newBalance,
    });
  } catch (error) {
    if (session.inTransaction()) await session.abortTransaction();
    throw error;
  } finally {
    await session.endSession();
  }
};

const createPayosRenewal = async ({ userId, entitlementId, idempotencyKey }) => {
  if (typeof idempotencyKey !== 'string' || idempotencyKey.length < 16 || idempotencyKey.length > 128) throw businessError('A stable request key of 16-128 characters is required.', 'INVALID_REQUEST_KEY');
  let renewal = await MembershipEntitlementRenewal.findOne({ userId, idempotencyKey });
  if (renewal && (String(renewal.entitlementId) !== String(entitlementId) || renewal.paymentMethod !== 'payos')) throw businessError('This request key belongs to another renewal operation.', 'RENEWAL_CONTEXT_MISMATCH', 409);
  if (renewal && !['pending', 'paid'].includes(renewal.status)) throw businessError('This renewal attempt is closed. Start a new renewal.', 'RENEWAL_ATTEMPT_CLOSED', 409);
  if (!renewal) {
    const quote = await getQuote(userId, entitlementId);
    if (quote.amount <= 0) throw businessError('Use Wallet to activate a zero-price renewal.', 'ZERO_PRICE_USE_WALLET');
    const transaction = await mongoose.startSession();
    try { await transaction.withTransaction(async () => {
      await assertNoMembershipBookingConflict({ floorId: quote.entitlement.floorId, slotCode: quote.entitlement.slotCode,
        validFrom: quote.oldExpireAt, expireAt: quote.newExpireAt, session: transaction });
      const locked = await MembershipSlotEntitlement.updateOne({ _id: entitlementId, ownerId: userId, status: 'active', expireAt: quote.oldExpireAt }, { $inc: { __v: 1 } }, { session: transaction });
      if (!locked.matchedCount) throw businessError('Membership changed. Refresh before creating a payment.', 'RENEWAL_STATE_CHANGED', 409);
      [renewal] = await MembershipEntitlementRenewal.create([{
      entitlementId, userId, status: 'pending', paymentMethod: 'payos', idempotencyKey,
      orderCode: generateOrderCode('entitlementRenewal'),
      oldExpireAt: quote.oldExpireAt, newExpireAt: quote.newExpireAt, amount: quote.amount,
      sourceSubscriptionId: quote.sourceSubscriptionId, packageSnapshot: quote.package,
      }], { session: transaction });
    }); } finally { await transaction.endSession(); }
  }
  if (renewal.status === 'paid' || renewal.payosCheckoutUrl) return publicResult(renewal, { checkoutUrl: renewal.payosCheckoutUrl, paymentLinkId: renewal.payosPaymentLinkId, alreadyProcessed: renewal.status === 'paid' });
  const clientUrl = (process.env.CLIENT_URL || 'http://localhost:5173').replace(/\/+$/, '');
  try {
    const payment = await ensurePaymentLink({
      orderCode: renewal.orderCode, amount: renewal.amount, description: 'VALO Renew Space',
      returnUrl: `${clientUrl}/customer/membership-transfers?entitlementId=${encodeURIComponent(entitlementId)}&entitlementRenewOrderCode=${renewal.orderCode}`,
      cancelUrl: `${clientUrl}/customer/membership-transfers?entitlementId=${encodeURIComponent(entitlementId)}&entitlementRenewOrderCode=${renewal.orderCode}&cancel=true`,
    });
    await MembershipEntitlementRenewal.updateOne({ _id: renewal._id }, { $set: { payosPaymentLinkId: payment.paymentLinkId, payosCheckoutUrl: payment.checkoutUrl, failureReason: '' } });
    return publicResult(renewal, { checkoutUrl: payment.checkoutUrl, paymentLinkId: payment.paymentLinkId, qrCode: payment.qrCode, alreadyProcessed: false });
  } catch (error) {
    // A timeout is not proof of failure. Retain this order and its pending lock.
    await MembershipEntitlementRenewal.updateOne({ _id: renewal._id, status: 'pending' }, { $set: { failureReason: error.message } });
    throw error;
  }
};

const verifyPayosRenewal = async ({ userId, orderCode, app = null }) => {
  const renewal = await MembershipEntitlementRenewal.findOne({
    userId,
    orderCode: Number(orderCode),
    paymentMethod: 'payos',
  });
  if (!renewal) throw businessError('Renewal not found.', 'RENEWAL_NOT_FOUND', 404);
  if (renewal.status === 'paid') return publicResult(renewal, { alreadyProcessed: true });
  if (!['pending', 'failed'].includes(renewal.status)) throw businessError('This renewal payment is closed.', 'RENEWAL_ATTEMPT_CLOSED', 409);
  const payment = await payos.paymentRequests.get(Number(orderCode));
  if (payment.status !== 'PAID') {
    if (['CANCELLED', 'FAILED', 'EXPIRED'].includes(payment.status)) {
      renewal.status = 'cancelled';
      renewal.failureReason = payment.status;
      await renewal.save();
    }
    throw businessError('Payment not completed.', ['CANCELLED', 'FAILED', 'EXPIRED'].includes(payment.status) ? 'PAYMENT_ORDER_CLOSED' : 'PAYMENT_NOT_COMPLETED');
  }
  assertPaymentMatches(payment, orderCode, renewal.amount);
  await MembershipEntitlementRenewal.updateOne({ _id: renewal._id }, { $set: { paymentConfirmedAt: new Date() } });
  let quote;
  try {
    quote = await getQuote(userId, renewal.entitlementId, { now: renewal.createdAt, ignoreRenewalId: renewal._id, packageSnapshot: renewal.packageSnapshot });
  } catch (error) {
    await MembershipEntitlementRenewal.updateOne({ _id: renewal._id }, { $set: { failureReason: error.message } });
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
    const current = await MembershipEntitlementRenewal.findById(renewal._id).session(session);
    if (current.status === 'paid') {
      await session.commitTransaction();
      return publicResult(current, { alreadyProcessed: true });
    }
    await activateInTransaction({ renewal: current, quote, session });
    await session.commitTransaction();
    await require('./membershipNotifications').notifyRenewal(current, 'entitlement', app).catch((error) => console.error('Renewal notification deferred:', error.message));
    return publicResult(current, { alreadyProcessed: false });
  } catch (error) {
    if (session.inTransaction()) await session.abortTransaction();
    await MembershipEntitlementRenewal.updateOne({ _id: renewal._id, status: { $ne: 'paid' } }, { $set: { failureReason: error.message } });
    if (['MEMBERSHIP_BOOKING_CONFLICT', 'MEMBERSHIP_HOLD_CONFLICT'].includes(error.code)) {
      throw businessError('Payment is confirmed, but the renewal interval conflicts with a booking or hold. Do not pay again; keep the renewal reference for support reconciliation.', 'PAID_RENEWAL_RECONCILIATION', 409);
    }
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
