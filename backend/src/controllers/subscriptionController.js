const Session = require('../models/Session');
const { assertPaymentMatches } = require('../services/ticketPackageTerms');
const { isInRenewalWindow } = require('../utils/membershipRenewalWindow');
const Subscription = require('../models/Subscription');
const mongoose = require('mongoose');
const TicketPackage = require('../models/TicketPackage');
const User = require('../models/User');
const Slot = require('../models/Slot');
const payos = require('../config/payos');
const {
  buildAccountMembershipQrPayload,
  buildMembershipQrPayload,
  isMembershipQrAvailable,
} = require('../services/membershipQrService');
const { validationResult } = require('express-validator');
const MembershipSlotEntitlement = require('../models/MembershipSlotEntitlement');
const {
  activateSubscriptionEntitlements,
} = require('../services/membershipEntitlementService');
const {
  getUnmigratedLegacySlots,
  preserveFloorReference,
} = require('../services/membershipProjectionService');
const {
  buildAdminSubscriptionProjection,
} = require('../services/adminSubscriptionProjectionService');
const { notifySubscriptionActivatedSafely } = require('../services/aiCopilot/notificationEvents');


// New Monthly periods are exactly 720 hours; historical timestamps are untouched.
const buildExpirationDate = (pkg, fromDate = new Date()) => require('../services/ticketPackageTerms').addConfiguredDuration(fromDate, typeof pkg === 'string' ? { type: pkg } : pkg);


// Create payment order for subscription
exports.createSubscriptionPayment = async (req, res, next) => {
  try {
    const data = await require('../services/subscriptionPurchaseService').purchase({
      ...req.body, userId: req.user._id, paymentMethod: 'payos',
    });
    res.json({ success: true, data });
  } catch (error) { next(error); }
};

// PayOS callback uses the provider signature and still verifies the provider's
// authoritative payment-link record through the same activation implementation.
exports.handlePaymentWebhook = async (req, res, next) => {
  try {
    let payment;
    try { payment = await payos.webhooks.verify(req.body); }
    catch { return res.status(400).json({ success: false, message: 'Invalid payment signature.' }); }
    if (payment.code !== '00') return res.json({ success: true });
    const orderCode = Number(payment.orderCode);
    if (!Number.isSafeInteger(orderCode) || orderCode <= 0) return res.status(400).json({ success: false, message: 'Invalid payment order.' });
    const [purchase, entitlementRenewal, subscriptionRenewal, checkout, booking, topUp] = await Promise.all([
      Subscription.findOne({ $and: [{ $or: [{ orderCode }, { 'pendingRenewal.orderCode': orderCode }] }, { $or: [{ paymentMethod: 'payos' }, { bindingVersion: { $ne: 1 } }] }] }),
      require('../models/MembershipEntitlementRenewal').findOne({ orderCode, paymentMethod: 'payos' }),
      require('../models/SubscriptionRenewal').findOne({ orderCode, paymentMethod: 'payos' }),
      require('../models/CheckoutAttempt').findOne({ orderCode }),
      require('../models/Booking').findOne({ vietqrOrderCode: orderCode }),
      require('../models/WalletTransaction').findOne({ payosOrderCode: orderCode, type: 'TOP_UP' }),
    ]);
    const matches = [purchase, entitlementRenewal, subscriptionRenewal, checkout, booking, topUp].filter(Boolean);
    if (!matches.length) return res.json({ success: true }); // Unknown/provider verification events.
    if (matches.length !== 1) return res.status(409).json({ success: false, message: 'Ambiguous historical payment order. Reconciliation is required.' });
    const expected = checkout ? checkout.amountDue : booking ? booking.prepaidAmount : purchase?.pendingRenewal?.orderCode === orderCode ? purchase.pendingRenewal.amount : matches[0].amount;
    if (!Number.isSafeInteger(Number(payment.amount)) || Number(payment.amount) <= 0 || Number(payment.amount) > expected) return res.status(409).json({ success: false, message: 'Payment amount mismatch.' });
    // Signed callbacks are notifications; the provider record confirms settlement.
    const provider = await payos.paymentRequests.get(orderCode);
    assertPaymentMatches(provider, orderCode, expected);
    if (Number(payment.amount) !== expected && !provider.transactions?.some((transaction) => transaction.reference === payment.reference && Number(transaction.amount) === Number(payment.amount))) return res.status(409).json({ success: false, message: 'Payment transfer does not belong to this order.' });
    if (checkout) {
      if (checkout.status === 'settled') return res.json({ success: true });
      await require('../services/checkoutAttemptService').verifyAttempt({ attemptId: checkout._id, sessionId: checkout.sessionId });
      return res.json({ success: true }); // Checkout and gate authorization still need the operator/vehicle.
    }
    if (entitlementRenewal || subscriptionRenewal) {
      const renewal = entitlementRenewal || subscriptionRenewal;
      const service = require(entitlementRenewal ? '../services/membershipEntitlementRenewalService' : '../services/subscriptionRenewalService');
      await service.verifyPayosRenewal({ userId: renewal.userId, orderCode, app: req.app });
      return res.json({ success: true });
    }
    if (booking) return require('./bookingController').handleBookingWebhook(req, res, next);
    if (topUp) return require('./walletController').handleWebhook(req, res, next);
    req.user = { _id: purchase.user };
    req.body = { orderCode };
    return exports.verifyPayment(req, res, next);
  } catch (error) { next(error); }
};

// Verify payment
exports.verifyPayment = async (req, res, next) => {
  let confirmed = null;
  try {
    const orderCode = Number(req.body.orderCode);
    if (!Number.isSafeInteger(orderCode) || orderCode <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid payment order.' });
    }
    const purchase = await Subscription.findOne({
      user: req.user._id, $or: [{ orderCode }, { 'pendingRenewal.orderCode': orderCode }],
    });
    if (!purchase) return res.status(404).json({ success: false, message: 'Subscription not found.' });
    const legacyRenewal = Number(purchase.pendingRenewal?.orderCode) === orderCode;
    if (purchase.bindingVersion === 1 && purchase.paymentMethod !== 'payos') return res.status(409).json({ success: false, message: 'This order does not use PayOS.' });
    const needsRepair = purchase.paymentStatus === 'paid' && await MembershipSlotEntitlement.countDocuments({ sourceSubscriptionId: purchase._id }) < purchase.slots.length;
    if (purchase.paymentStatus === 'paid' && !legacyRenewal && purchase.status !== 'failed' && !needsRepair) {
      return res.json({ success: true, message: 'Already paid.', data: { expireAt: purchase.expireAt, validFrom: purchase.validFrom } });
    }
    const payment = await payos.paymentRequests.get(orderCode);
    if (payment.status !== 'PAID') {
      if (!legacyRenewal && ['CANCELLED', 'FAILED', 'EXPIRED'].includes(payment.status)) {
        const state = 'cancelled';
        await Subscription.updateOne({ _id: purchase._id, status: 'pending', paymentStatus: 'pending' }, { $set: { status: state, paymentStatus: state } });
      }
      return res.status(409).json({ success: false, code: ['CANCELLED', 'FAILED', 'EXPIRED'].includes(payment.status) ? 'PAYMENT_ORDER_CLOSED' : 'PAYMENT_NOT_COMPLETED', message: 'Payment not completed.' });
    }
    assertPaymentMatches(payment, orderCode, legacyRenewal ? purchase.pendingRenewal.amount : purchase.amount);
    confirmed = purchase._id;
    const activationTime = purchase.activatedAt || new Date();
    const dbSession = await mongoose.startSession();
    try {
      await dbSession.withTransaction(async () => {
        const current = await Subscription.findById(purchase._id).session(dbSession);
        if (legacyRenewal) {
          await require('../services/legacyEntitlementCompatibilityService').lockOwner(current.user, dbSession);
          if (Number(current.pendingRenewal?.orderCode) !== orderCode) return;
          const period = current.pendingRenewal;
          // Historical PayOS renewal orders still enter through this callback.
          // Protect their extension just like the dedicated renewal services.
          for (const slot of current.slots) {
            await require('../services/membershipBookingConflictService').assertNoMembershipBookingConflict({
              floorId: slot.floorId, slotCode: slot.slotCode, validFrom: current.expireAt,
              expireAt: period.newExpireAt, session: dbSession,
            });
          }
          current.expireAt = period.newExpireAt;
          if (!current.rewardPayments.some((entry) => entry.orderCode === orderCode)) {
            current.rewardPayments.push({ orderCode, userId: current.user, amount: period.amount, paidAt: new Date() });
          }
          current.pendingRenewal = undefined;
          await MembershipSlotEntitlement.updateMany({
            sourceSubscriptionId: current._id, ownerId: current.user, status: 'active',
          }, { $set: { expireAt: period.newExpireAt } }, { session: dbSession });
          await Slot.updateMany({ reservedBySubscriptionId: current._id, reservedFor: current.user },
            { $set: { reservedUntil: period.newExpireAt } }, { session: dbSession });
        } else {
          if (current.paymentStatus === 'paid' && current.status !== 'failed' && !needsRepair) return;
          if (current.packageSnapshot && !current.activatedAt) {
            current.activatedAt = activationTime;
            current.validFrom = activationTime;
            current.expireAt = buildExpirationDate(current.packageSnapshot, activationTime);
          }
        }
        current.paymentStatus = 'paid';
        current.status = 'active';
        current.activationFailureReason = undefined;
        current.reconciliationRequired = false;
        await current.save({ session: dbSession });
        await activateSubscriptionEntitlements(current, { session: dbSession });
        const type = current.packageSnapshot?.type || (await TicketPackage.findById(current.ticketPackage).session(dbSession))?.type;
        if (!legacyRenewal && !current.bindingVersion && type === 'yearly') {
          await User.updateOne({ _id: current.user }, { $set: { 'membership.freeServiceCount': 12 } }, { session: dbSession });
        }
      });
    } finally { await dbSession.endSession(); }
    const activated = await Subscription.findById(purchase._id);
    if (activated?.status === 'active') notifySubscriptionActivatedSafely(activated, activated.packageSnapshot || await TicketPackage.findById(activated.ticketPackage), req.app);
    return res.json({ success: true, message: 'Payment confirmed and membership activated.', data: { expireAt: activated.expireAt, validFrom: activated.validFrom } });
  } catch (error) {
    if (confirmed) {
      // Never overwrite a concurrent successful activation with a failure.
      await Subscription.updateOne({ _id: confirmed, status: { $ne: 'active' } }, {
        $set: { paymentStatus: 'paid', status: 'failed', activationFailureReason: error.message, reconciliationRequired: true },
      });
    }
    if (confirmed) { error.code = 'PAID_PURCHASE_RECONCILIATION'; error.statusCode = 409; error.message = 'Payment received, but activation requires reconciliation. Do not pay again. Keep the order reference and contact support.'; }
    next(error);
  }
};

// Pay subscription with Valo Wallet
exports.paySubscriptionWithWallet = async (req, res, next) => {
  try {
    const data = await require('../services/subscriptionPurchaseService').purchase({
      ...req.body, userId: req.user._id, paymentMethod: 'wallet',
    });
    const activated = await Subscription.findById(data.subscriptionId);
    if (activated?.status === 'active') notifySubscriptionActivatedSafely(activated, activated.packageSnapshot, req.app);
    res.json({ success: true, data });
  } catch (error) { next(error); }
};

exports.getMembership = async (req, res, next) => {
  try {
    const now = new Date();
    const user = await User.findById(req.user._id)
      .select('membership')
      .populate(
        'membership.packageId',
        'name type price description isActive isRenewable renewalWindowDays maxSlots'
      )
      .lean();

    const [entitlements, activeSubscriptions] = await Promise.all([
      MembershipSlotEntitlement.find({
        ownerId: req.user._id,
        validFrom: { $lte: now },
        status: { $in: ['active', 'transfer_locked'] },
        expireAt: { $gt: now },
      })
        .sort({ expireAt: -1 })
        .populate('vehicleId', 'licensePlate')
        .populate(
          'packageId',
          'name type price description isActive isRenewable renewalWindowDays maxSlots'
        )
        .populate({ path: 'floorId', select: 'name floorNumber', transform: preserveFloorReference })
        .lean(),
      Subscription.find({
      user: req.user._id,
      validFrom: { $lte: now },
      status: 'active',
      paymentStatus: 'paid',
      expireAt: { $gt: now }
      })
        .sort({ expireAt: -1 })
        .populate(
          'ticketPackage',
          'name type price description isActive isRenewable renewalWindowDays maxSlots'
        )
        .populate({ path: 'slots.floorId', select: 'name floorNumber', transform: preserveFloorReference })
        .lean(),
    ]);

    const sourceEntitlements = activeSubscriptions.length
      ? await MembershipSlotEntitlement.find({
          sourceSubscriptionId: {
            $in: activeSubscriptions.map((subscription) => subscription._id),
          },
        })
          .select('sourceSubscriptionId floorId slotCode')
          .lean()
      : [];
    const legacySlots = getUnmigratedLegacySlots(
      activeSubscriptions,
      sourceEntitlements
    );

    const activeParkingSession = await Session.findOne({ userId: req.user._id, type: 'SUBSCRIPTION', status: 'active' }).select('subscriptionId');
    const pendingPayments = [];
    for (const [Model, kind, ownerField, targetField] of [
      [Subscription, 'purchase', 'user', '_id'],
      [require('../models/MembershipEntitlementRenewal'), 'entitlement', 'userId', 'entitlementId'],
      [require('../models/SubscriptionRenewal'), 'subscription', 'userId', 'subscriptionId'],
    ]) {
      const orders = await Model.find({ [ownerField]: req.user._id, paymentMethod: 'payos', status: { $in: ['pending', 'failed'] } }).sort({ createdAt: -1 }).limit(20).lean();
      for (const order of orders) pendingPayments.push({ kind, targetId: order[targetField], packageId: order.ticketPackage,
        orderCode: order.orderCode, amount: order.amount, checkoutUrl: order.payosCheckoutUrl,
        idempotencyKey: order.idempotencyKey, slots: order.slots,
        name: order.packageSnapshot?.name || 'Membership payment', status: order.status,
        reconciliationRequired: Boolean(order.reconciliationRequired), activationFailureReason: order.activationFailureReason,
      });
    }
    const latestEntitlement = entitlements[0] || null;
    const latestSubscription = legacySlots[0]?.subscription || null;
    const expireAt = latestEntitlement?.expireAt
      ? new Date(latestEntitlement.expireAt)
      : latestSubscription?.expireAt
        ? new Date(latestSubscription.expireAt)
        : null;
    const isActive = Boolean(entitlements.length || legacySlots.length);
    const daysUntilExpiration = expireAt
      ? Math.ceil((expireAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
      : null;
    const purchasedTerms = latestEntitlement?.packageSnapshot || latestSubscription?.packageSnapshot;
    const pkg = purchasedTerms ? { ...purchasedTerms, _id: purchasedTerms.id, price: purchasedTerms.unitPrice } :
      latestEntitlement?.packageId ||
      latestSubscription?.ticketPackage ||
      user?.membership?.packageId ||
      null;

    const renewalWindowDays = Number(pkg?.renewalWindowDays || 7);
    const legacyRenewal = latestSubscription && !entitlements.length
      ? await require('../services/membershipDetailsService').renewalState(req.user._id, latestSubscription, 'subscription', now)
      : { canRenew: false, renewalWindowDays, message: 'Select a space below to review its renewal eligibility.' };


    const reservedSlots = [
      ...await Promise.all(entitlements.map((entitlement) =>
        require('../services/membershipDetailsService').presentEntitlement(req.user._id, entitlement, now)
      )),
      ...await Promise.all(legacySlots.map(async ({ subscription, slot }) => ({
        entitlementId: null,
        sourceSubscriptionId: subscription._id,
        floorId: slot.floorId?._id || slot.floorId,
        floorName: slot.floorId?.name || '',
        floorNumber: slot.floorId?.floorNumber || null,
        slotCode: slot.slotCode,
        status: 'active',
        validFrom: subscription.validFrom,
        expireAt: subscription.expireAt,
        unitAmount:
          Number(subscription.amount || 0) /
          Math.max(1, (subscription.slots || []).length),
        transferCount: 0,
        canTransfer: false,
        legacy: true,
        daysRemaining: Math.max(0, Math.ceil((new Date(subscription.expireAt) - now) / 86400000)),
        expiringSoon: isInRenewalWindow(subscription.expireAt, subscription.ticketPackage, now),
        renewal: await require('../services/membershipDetailsService').renewalState(req.user._id, subscription, 'subscription', now),
      }))),
    ];

    res.status(200).json({
      success: true,
      data: {
        isVip: isActive,
        hasActiveParkingSession: Boolean(activeParkingSession),
        purchaseEligibility: await require('../services/subscriptionEligibilityService').getPurchaseVehicleEligibility({ userId: req.user._id, now }),
        pendingPayments,
        status: isActive ? 'active' : 'expired',
        subscriptionId:
          latestEntitlement?.sourceSubscriptionId || latestSubscription?._id || activeParkingSession?.subscriptionId || null,
        entitlementCount: reservedSlots.length,
        expireAt,
        daysUntilExpiration,
        expirationWarning: reservedSlots.some((slot) => slot.expiringSoon),
        earliestExpireAt: reservedSlots.length ? new Date(Math.min(...reservedSlots.map((slot) => new Date(slot.expireAt).getTime()))) : null,
        expiringEntitlementCount: reservedSlots.filter((slot) => slot.expiringSoon).length,
        freeServiceCount: user?.membership?.freeServiceCount || 0,
        package: pkg
          ? {
              id: pkg._id,
              name: pkg.name,
              type: pkg.type,
              price: pkg.price,
              description: pkg.description,
            }
          : null,
        reservedSlots,
        benefits: isActive
          ? ['Reserved parking spaces', 'See each space for its purchased vehicle and parking benefits']
          : [],
        renewal: {
          status: 'manual',
          nextRenewalDate: expireAt,
          price: pkg?.price || 0,
          ...legacyRenewal,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

exports.getMembershipQr = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array().map((error) => ({
          field: error.path || error.param,
          message: error.msg,
        })),
      });
    }

    const query = { _id: req.params.subscriptionId };
    if (req.user.role !== 'admin') {
      query.user = req.user._id;
    }

    const subscription = await Subscription.findOne(query);
    if (!subscription) {
      return res.status(404).json({ success: false, message: 'Membership not found' });
    }

    const [user, latestEntitlement] = await Promise.all([
      User.findById(subscription.user).select('membership'),
      MembershipSlotEntitlement.findOne({
        ownerId: subscription.user,
        status: { $in: ['active', 'transfer_locked'] },
        expireAt: { $gt: new Date() },
      }).sort({ expireAt: -1 }),
    ]);
    const exitOnly = !latestEntitlement && Boolean(await Session.exists({ userId: subscription.user, type: 'SUBSCRIPTION', status: 'active' }));
    const useAccountCredential = Boolean(latestEntitlement || exitOnly);
    const available = useAccountCredential
      ? Boolean(user)
      : isMembershipQrAvailable(subscription);
    return res.status(200).json({
      success: true,
      data: {
        available,
        credentialType: useAccountCredential ? 'ACCOUNT' : 'LEGACY_SUBSCRIPTION',
        membershipStatus: exitOnly ? 'exit_only' : available ? 'active' : subscription.status,
        expireAt: useAccountCredential
          ? latestEntitlement?.expireAt
          : subscription.expireAt,
        payload: available
          ? useAccountCredential
            ? buildAccountMembershipQrPayload(user)
            : buildMembershipQrPayload(subscription)
          : null,
        reason: available ? null : 'MEMBERSHIP_QR_INACTIVE',
      },
    });
  } catch (error) {
    next(error);
  }
};

exports.getAccountMembershipQr = async (req, res, next) => {
  try {
    const now = new Date();
    const [user, latestEntitlement] = await Promise.all([
      User.findById(req.user._id).select('membership'),
      MembershipSlotEntitlement.findOne({
        ownerId: req.user._id,
        status: { $in: ['active', 'transfer_locked'] },
        expireAt: { $gt: now },
      }).sort({ expireAt: -1 }),
    ]);
    if (!user) {
      return res.status(404).json({ success: false, message: 'Membership account not found' });
    }
    const exitOnly = !latestEntitlement && Boolean(await Session.exists({ userId: req.user._id, type: 'SUBSCRIPTION', status: 'active' }));
    if (latestEntitlement || exitOnly) {
      return res.status(200).json({
        success: true,
        data: {
          available: true,
          credentialType: 'ACCOUNT',
          membershipStatus: exitOnly ? 'exit_only' : 'active',
          expireAt: latestEntitlement?.expireAt || null,
          payload: buildAccountMembershipQrPayload(user),
          reason: null,
        },
      });
    }

    const legacySubscription = await Subscription.findOne({
      user: req.user._id,
      status: 'active',
      paymentStatus: 'paid',
      expireAt: { $gt: now },
    }).sort({ expireAt: -1 });
    const available = isMembershipQrAvailable(legacySubscription);
    return res.status(200).json({
      success: true,
      data: {
        available,
        credentialType: 'LEGACY_SUBSCRIPTION',
        membershipStatus: available ? 'active' : 'expired',
        expireAt: legacySubscription?.expireAt || null,
        payload: available ? buildMembershipQrPayload(legacySubscription) : null,
        reason: available ? null : 'MEMBERSHIP_QR_INACTIVE',
      },
    });
  } catch (error) {
    next(error);
  }
};

exports.buildExpirationDate = buildExpirationDate;

// Admin: Get all subscriptions
exports.getAllSubscriptions = async (req, res, next) => {
  try {
    const subscriptions = await Subscription.find()
      .select(req.user.role === 'staff' ? '-payosCheckoutUrl -payosPaymentLinkId -idempotencyKey -rewardPayments' : '')
      .populate('user', 'username email status')
      .populate('ticketPackage', 'name type price')
      .populate({
        path: 'slots.floorId',
        select: 'name floorNumber'
      })
      .sort({ createdAt: -1 })
      .lean();

    const subscriptionIds = subscriptions.map((subscription) => subscription._id);
    const entitlements = await MembershipSlotEntitlement.find({
      sourceSubscriptionId: { $in: subscriptionIds },
    })
      .select('sourceSubscriptionId ownerId')
      .populate('ownerId', 'username email status')
      .lean();

    const referencedUserIds = [
      ...subscriptions.map((subscription) => subscription.user?._id),
      ...entitlements.map((entitlement) => entitlement.ownerId?._id),
    ].filter(Boolean);
    const Vehicle = require('../models/Vehicle');
    const vehicles = await Vehicle.find({ owner: { $in: referencedUserIds } })
      .select('owner licensePlate')
      .lean();
    const enhancedSubscriptions = buildAdminSubscriptionProjection({
      subscriptions,
      entitlements,
      vehicles,
    });

    res.status(200).json({
      success: true,
      data: enhancedSubscriptions
    });
  } catch (error) {
    next(error);
  }
};

// Renew subscription
exports.renewSubscription = async (req, res, next) => {
  try {
    const { subscriptionId, paymentMethod, idempotencyKey } = req.body;
    if (typeof idempotencyKey !== 'string' || idempotencyKey.trim().length < 16 || idempotencyKey.length > 128) {
      return res.status(400).json({ success: false, message: 'A stable idempotency key (16-128 characters) is required.' });
    }
    const renewals = require('../services/subscriptionRenewalService');
    const action = paymentMethod === 'WALLET' ? renewals.renewWithWallet
      : paymentMethod === 'PAYOS' ? renewals.createPayosRenewal : null;
    if (!action) return res.status(400).json({ success: false, message: 'Invalid payment method.' });
    const data = await action({ userId: req.user._id, subscriptionId, idempotencyKey, app: req.app });
    res.json({ success: true, data });
  } catch (error) { next(error); }
};
