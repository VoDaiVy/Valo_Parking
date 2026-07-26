const Subscription = require('../models/Subscription');
const mongoose = require('mongoose');
const TicketPackage = require('../models/TicketPackage');
const User = require('../models/User');
const Slot = require('../models/Slot');
const payos = require('../config/payos');
const walletService = require('../services/walletService');
const {
  validateNewSubscriptionEligibility,
} = require('../services/subscriptionEligibilityService');
const { isEnabled, defaultForCurrentEnvironment } = require('../utils/featureFlags');
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
} = require('../services/membershipProjectionService');
const {
  buildSubscriptionPaymentUrls,
} = require('../utils/subscriptionPaymentUrls');
const {
  buildAdminSubscriptionProjection,
} = require('../services/adminSubscriptionProjectionService');

const buildExpirationDate = (packageType, fromDate = new Date()) => {
  const expireAt = new Date(fromDate);
  if (packageType === 'monthly') {
    expireAt.setMonth(expireAt.getMonth() + 1);
  } else {
    expireAt.setFullYear(expireAt.getFullYear() + 1);
  }
  return expireAt;
};

// Create payment order for subscription
exports.createSubscriptionPayment = async (req, res, next) => {
  try {
    const { packageId, slots } = req.body;
    
    // Validate package
    const ticketPackage = await TicketPackage.findById(packageId);
    if (!ticketPackage || !['monthly', 'yearly'].includes(ticketPackage.type) || !ticketPackage.isActive) {
      return res.status(400).json({ success: false, message: 'Invalid subscription package.' });
    }

    const eligibility = await validateNewSubscriptionEligibility({
      userId: req.user._id,
      ticketPackage,
      slots,
    });

    // Amount to pay (price * number of slots)
    const amount = ticketPackage.price * Math.max(1, slots.length);

    // Generate Order Code for PayOS
    const orderCode = Number(String(Date.now()).slice(-6) + Math.floor(Math.random() * 100));

    // Calculate expiration date
    const expireAt = buildExpirationDate(ticketPackage.type);
    const paymentUrls = buildSubscriptionPaymentUrls(orderCode);

    // Call PayOS API to create payment link
    const paymentData = {
      orderCode,
      amount: parseInt(amount),
      description: `VIP ${ticketPackage.type === 'monthly' ? 'Thang' : 'Nam'}`,
      returnUrl: paymentUrls.returnUrl,
      cancelUrl: paymentUrls.cancelUrl,
      items: [
        {
          name: `VIP ${ticketPackage.type === 'monthly' ? 'Month' : 'Year'}`,
          quantity: 1,
          price: parseInt(amount),
        },
      ],
    };

    const paymentLink = await payos.paymentRequests.create(paymentData);
    const checkoutUrl = paymentLink.checkoutUrl;

    // Create pending subscription
    const subscription = new Subscription({
      user: req.user._id,
      ticketPackage: ticketPackage._id,
      slots: eligibility.normalizedSlots,
      amount,
      orderCode,
      expireAt,
      paymentStatus: 'pending'
    });
    await subscription.save();

    res.status(200).json({
      success: true,
      data: {
        subscriptionId: subscription._id,
        orderCode,
        amount,
        checkoutUrl, // Client will redirect or show QR code
        qrCode: paymentLink.qrCode,
        paymentLinkId: paymentLink.paymentLinkId,
      }
    });

  } catch (error) {
    next(error);
  }
};

// Verify payment
exports.verifyPayment = async (req, res, next) => {
  try {
    const { orderCode } = req.body;
    
    const subscription = await Subscription.findOne({
      $or: [{ orderCode }, { 'pendingRenewal.orderCode': orderCode }],
      user: req.user._id
    });
    
    if (!subscription) {
      return res.status(404).json({ success: false, message: 'Subscription not found.' });
    }

    const isRenewal = subscription.pendingRenewal && subscription.pendingRenewal.orderCode == orderCode;

    if (!isRenewal && subscription.paymentStatus === 'paid') {
      const entitlementCount = await MembershipSlotEntitlement.countDocuments({
        sourceSubscriptionId: subscription._id,
      });
      if (entitlementCount < (subscription.slots || []).length) {
        subscription.status = 'active';
        await subscription.save();
        try {
          await activateSubscriptionEntitlements(subscription);
        } catch (activationError) {
          subscription.status = 'failed';
          await subscription.save();
          throw activationError;
        }
        return res.status(200).json({
          success: true,
          message: 'Payment was already completed and membership activation was repaired.',
        });
      }
      return res.status(200).json({ success: true, message: 'Already paid.' });
    }

    // Verify via PayOS API
    let isPaymentSuccessful = false;
    try {
      const payosInfo = await payos.paymentRequests.get(parseInt(orderCode));
      if (payosInfo.status === 'PAID') {
        isPaymentSuccessful = true;
      }
    } catch (payosError) {
      console.error('Error checking PayOS status for subscription:', payosError.message);
    }
    
    if (isPaymentSuccessful) {
      if (isRenewal) {
        subscription.expireAt = subscription.pendingRenewal.newExpireAt;
        subscription.status = 'active';
        subscription.expireWarningSent = false;
        subscription.pendingRenewal = undefined;
        await subscription.save();
        await activateSubscriptionEntitlements(subscription);
      } else {
        const activationSession = await mongoose.startSession();
        activationSession.startTransaction();
        try {
          subscription.paymentStatus = 'paid';
          subscription.status = 'active';
          await subscription.save({ session: activationSession });
          const ticketPackage = await TicketPackage.findById(
            subscription.ticketPackage
          ).session(activationSession);
          if (ticketPackage?.type === 'yearly') {
            await User.updateOne(
              { _id: req.user._id },
              { $set: { 'membership.freeServiceCount': 12 } },
              { session: activationSession }
            );
          }
          await activateSubscriptionEntitlements(subscription, {
            session: activationSession,
          });
          await activationSession.commitTransaction();
        } catch (activationError) {
          await activationSession.abortTransaction();
          await Subscription.updateOne(
            { _id: subscription._id },
            { $set: { paymentStatus: 'paid', status: 'failed' } }
          );
          return res.status(409).json({
            success: false,
            code: 'MEMBERSHIP_ACTIVATION_FAILED',
            message:
              activationError.message ||
              'Payment succeeded but membership activation requires support.',
          });
        } finally {
          activationSession.endSession();
        }
      }

      return res.status(200).json({ success: true, message: isRenewal ? 'Subscription renewed successfully!' : 'Subscription activated successfully!' });
    } else {
      const payosInfo = await payos.paymentRequests.get(parseInt(orderCode)).catch(() => null);
      if (['CANCELLED', 'FAILED'].includes(payosInfo?.status)) {
        if (isRenewal) {
           subscription.pendingRenewal = undefined; // clear pending renewal if failed
           await subscription.save();
        } else {
           subscription.paymentStatus = payosInfo.status === 'CANCELLED' ? 'cancelled' : 'failed';
           subscription.status = payosInfo.status === 'CANCELLED' ? 'cancelled' : 'failed';
           await subscription.save();
        }
      }
      return res.status(400).json({ success: false, message: 'Payment not completed.' });
    }
  } catch (error) {
    next(error);
  }
};

// Pay subscription with Valo Wallet
exports.paySubscriptionWithWallet = async (req, res, next) => {
  try {
    const { packageId, slots } = req.body;
    
    // Validate package
    const ticketPackage = await TicketPackage.findById(packageId);
    if (!ticketPackage || !['monthly', 'yearly'].includes(ticketPackage.type) || !ticketPackage.isActive) {
      return res.status(400).json({ success: false, message: 'Invalid subscription package.' });
    }

    const eligibility = await validateNewSubscriptionEligibility({
      userId: req.user._id,
      ticketPackage,
      slots,
    });

    // Amount to pay (price * number of slots)
    const amount = ticketPackage.price * Math.max(1, slots.length);

    // Calculate expiration date
    const expireAt = buildExpirationDate(ticketPackage.type);

    // Create subscription
    const subscription = new Subscription({
      user: req.user._id,
      ticketPackage: ticketPackage._id,
      slots: eligibility.normalizedSlots,
      amount,
      orderCode: Number(String(Date.now()).slice(-6) + Math.floor(Math.random() * 100)),
      expireAt,
      paymentStatus: 'pending' // Will update after wallet debit
    });
    
    await subscription.save();

    const dbSession = await mongoose.startSession();
    dbSession.startTransaction();
    try {
      await walletService.debitWallet(req.user._id, amount, `Buy VIP Package - ${ticketPackage.type}`, {
        refSource: 'subscription',
        refSourceId: subscription._id.toString(),
        session: dbSession,
      });
      subscription.paymentStatus = 'paid';
      subscription.status = 'active';
      await subscription.save({ session: dbSession });

      if (ticketPackage.type === 'yearly') {
        await User.updateOne(
          { _id: req.user._id },
          { $set: { 'membership.freeServiceCount': 12 } },
          { session: dbSession }
        );
      }
      await activateSubscriptionEntitlements(subscription, { session: dbSession });
      await dbSession.commitTransaction();
    } catch (err) {
      await dbSession.abortTransaction();
      subscription.paymentStatus = 'failed';
      subscription.status = 'failed';
      await subscription.save();
      return res.status(err.statusCode || 400).json({
        success: false,
        message: err.message || 'Insufficient wallet balance.',
      });
    } finally {
      dbSession.endSession();
    }

    return res.status(200).json({ success: true, message: 'Subscription activated successfully via Valo Wallet!' });
  } catch (error) {
    next(error);
  }
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
        status: { $in: ['active', 'transfer_locked'] },
        expireAt: { $gt: now },
      })
        .sort({ expireAt: -1 })
        .populate(
          'packageId',
          'name type price description isActive isRenewable renewalWindowDays maxSlots'
        )
        .populate('floorId', 'name floorNumber')
        .lean(),
      Subscription.find({
      user: req.user._id,
      status: 'active',
      paymentStatus: 'paid',
      expireAt: { $gt: now }
      })
        .sort({ expireAt: -1 })
        .populate(
          'ticketPackage',
          'name type price description isActive isRenewable renewalWindowDays maxSlots'
        )
        .populate('slots.floorId', 'name floorNumber')
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
    const pkg =
      latestEntitlement?.packageId ||
      latestSubscription?.ticketPackage ||
      user?.membership?.packageId ||
      null;

    const renewalWindowDays = Number(pkg?.renewalWindowDays || 7);
    const canRenew = Boolean(
      isEnabled('SUBSCRIPTION_RENEWAL_ENABLED', defaultForCurrentEnvironment()) &&
      isActive &&
      latestSubscription?._id &&
      pkg?.isRenewable !== false &&
      daysUntilExpiration !== null &&
      daysUntilExpiration <= renewalWindowDays
    );

    const reservedSlots = [
      ...entitlements.map((entitlement) => ({
          entitlementId: entitlement._id,
          sourceSubscriptionId: entitlement.sourceSubscriptionId,
          floorId: entitlement.floorId?._id || entitlement.floorId,
          floorName: entitlement.floorId?.name || '',
          floorNumber: entitlement.floorId?.floorNumber || null,
          slotCode: entitlement.slotCode,
          status: entitlement.status,
          validFrom: entitlement.validFrom,
          expireAt: entitlement.expireAt,
          unitAmount: entitlement.unitAmount,
          transferCount: entitlement.transferCount,
          canTransfer:
            entitlement.status === 'active' &&
            Number(entitlement.transferCount || 0) < 1,
      })),
      ...legacySlots.map(({ subscription, slot }) => ({
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
      })),
    ];

    res.status(200).json({
      success: true,
      data: {
        isVip: isActive,
        status: isActive ? 'active' : 'expired',
        subscriptionId:
          latestEntitlement?.sourceSubscriptionId || latestSubscription?._id || null,
        entitlementCount: reservedSlots.length,
        expireAt,
        daysUntilExpiration,
        expirationWarning: Boolean(isActive && daysUntilExpiration !== null && daysUntilExpiration <= 7),
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
          ? ['Reserved VIP parking slots', 'Priority parking access', 'Membership parking coverage']
          : [],
        renewal: {
          status: 'manual',
          nextRenewalDate: expireAt,
          price: pkg?.price || 0,
          canRenew,
          renewalWindowDays,
          message: canRenew
            ? 'Your renewal window is open. Renew now to keep your reserved spaces.'
            : 'Manual renewal opens before your membership expires.',
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
    const useAccountCredential = Boolean(latestEntitlement);
    const available = useAccountCredential
      ? Boolean(user)
      : isMembershipQrAvailable(subscription);
    return res.status(200).json({
      success: true,
      data: {
        available,
        credentialType: useAccountCredential ? 'ACCOUNT' : 'LEGACY_SUBSCRIPTION',
        membershipStatus: available ? 'active' : subscription.status,
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
    if (latestEntitlement) {
      return res.status(200).json({
        success: true,
        data: {
          available: true,
          credentialType: 'ACCOUNT',
          membershipStatus: 'active',
          expireAt: latestEntitlement.expireAt,
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
    const { subscriptionId, paymentMethod } = req.body;
    
    const subscription = await Subscription.findById(subscriptionId).populate('ticketPackage');
    if (!subscription) {
      return res.status(404).json({ success: false, message: 'Subscription not found.' });
    }
    
    if (subscription.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }
    const entitlementCount = await MembershipSlotEntitlement.countDocuments({
      sourceSubscriptionId: subscription._id,
    });
    if (entitlementCount > 0) {
      return res.status(409).json({
        success: false,
        code: 'USE_ENTITLEMENT_RENEWAL',
        message: 'Renew each membership space separately.',
      });
    }

    if (!['active', 'expired'].includes(subscription.status)) {
      return res.status(400).json({ success: false, message: 'Can only renew active or expired subscriptions.' });
    }

    const ticketPackage = subscription.ticketPackage;
    if (!ticketPackage || !ticketPackage.isActive) {
      return res.status(400).json({ success: false, message: 'Package is no longer available.' });
    }

    const amount = ticketPackage.price * Math.max(1, subscription.slots.length);
    
    // Determine the base date for renewal
    const now = new Date();
    const baseDate = (subscription.status === 'active' && subscription.expireAt > now) 
                     ? subscription.expireAt 
                     : now;
                     
    const newExpireAt = buildExpirationDate(ticketPackage.type, baseDate);

    if (paymentMethod === 'WALLET') {
      try {
        await walletService.debitWallet(req.user._id, amount, `Renew VIP Package - ${ticketPackage.type}`, {
          refSource: 'subscription_renewal',
          refSourceId: subscription._id.toString()
        });
        
        subscription.expireAt = newExpireAt;
        subscription.status = 'active';
        subscription.expireWarningSent = false;
        
        // Also update User membership and Slot reservedFor to ensure they are active
        const user = await User.findById(req.user._id);
        user.membership.isVip = true;
        user.membership.expireAt = newExpireAt;
        if (ticketPackage.type === 'yearly') {
           user.membership.freeServiceCount = 12;
        }
        await user.save();

        for (const slot of subscription.slots) {
          await Slot.updateOne(
            { floorID: slot.floorId, slotNumber: slot.slotCode },
            { reservedFor: user._id }
          );
        }

        await subscription.save();
        return res.status(200).json({ success: true, message: 'Renewed successfully via Valo Wallet.', data: subscription });
      } catch (err) {
        return res.status(400).json({ success: false, message: err.message || 'Insufficient wallet balance.' });
      }
    } else if (paymentMethod === 'PAYOS') {
      const orderCode = Number(String(Date.now()).slice(-6) + Math.floor(Math.random() * 100));
      const paymentUrls = buildSubscriptionPaymentUrls(orderCode);
      const paymentData = {
        orderCode,
        amount: parseInt(amount),
        description: `Renew VIP ${ticketPackage.type}`,
        returnUrl: paymentUrls.returnUrl,
        cancelUrl: paymentUrls.cancelUrl,
        items: [{ name: `Renew VIP ${ticketPackage.type}`, quantity: 1, price: parseInt(amount) }]
      };

      const paymentLink = await payos.paymentRequests.create(paymentData);
      
      subscription.pendingRenewal = {
        orderCode,
        newExpireAt,
        amount
      };
      await subscription.save();

      return res.status(200).json({
        success: true,
        data: {
          subscriptionId: subscription._id,
          orderCode,
          amount,
          checkoutUrl: paymentLink.checkoutUrl
        }
      });
    } else {
      return res.status(400).json({ success: false, message: 'Invalid payment method.' });
    }

  } catch (error) {
    next(error);
  }
};
