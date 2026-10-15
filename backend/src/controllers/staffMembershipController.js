const mongoose = require('mongoose');
const cloudinary = require('../config/cloudinary');
const Session = require('../models/Session');
const Subscription = require('../models/Subscription');
const MembershipSlotEntitlement = require('../models/MembershipSlotEntitlement');
const User = require('../models/User');
const Vehicle = require('../models/Vehicle');
const StaffSubscriptionAction = require('../models/StaffSubscriptionAction');
const notifTriggers = require('../services/notificationTriggers');
const aiNotificationEvents = require('../services/aiCopilot/notificationEvents');
const {
  isMembershipQrAvailable,
  parseAndVerifyAnyMembershipQr,
} = require('../services/membershipQrService');
const { isEnabled } = require('../utils/featureFlags');
const { normalizeLicensePlate } = require('../utils/licensePlateUtils');

const EVIDENCE_IMAGE_PATTERN = /^data:image\/(jpeg|jpg|png|webp);base64,[A-Za-z0-9+/=\s]+$/;
const normalizeSlotCode = (slotCode = '') => String(slotCode).trim().toUpperCase();

const validateTransitionBody = (body = {}) => {
  const action = String(body.action || '').toUpperCase();
  const reason = String(body.reason || '').trim();
  const idempotencyKey = String(body.idempotencyKey || '').trim();
  const evidenceImageBase64 = body.evidenceImageBase64;

  if (!['CHECK_IN', 'CHECK_OUT'].includes(action)) {
    return { error: 'Action must be CHECK_IN or CHECK_OUT' };
  }
  if (!reason || reason.length > 500) {
    return { error: 'A reason of at most 500 characters is required' };
  }
  if (!idempotencyKey || idempotencyKey.length > 100) {
    return { error: 'A valid idempotency key is required' };
  }
  if (
    typeof evidenceImageBase64 !== 'string' ||
    evidenceImageBase64.length > 20 * 1024 * 1024 ||
    !EVIDENCE_IMAGE_PATTERN.test(evidenceImageBase64)
  ) {
    return { error: 'A JPEG, PNG, or WebP evidence image is required' };
  }
  if (action === 'CHECK_IN') {
    if (!mongoose.Types.ObjectId.isValid(body.vehicleId)) {
      return { error: 'A valid membership vehicle is required' };
    }
    if (!mongoose.Types.ObjectId.isValid(body.floorId) || !normalizeSlotCode(body.parkingSlot)) {
      return { error: 'A reserved membership space is required' };
    }
  } else if (!mongoose.Types.ObjectId.isValid(body.sessionId)) {
    return { error: 'An active membership session is required' };
  }

  return { action, reason, idempotencyKey, evidenceImageBase64 };
};

const findVerifiedMembership = async (payload) => {
  const parsed = parseAndVerifyAnyMembershipQr(payload);
  if (parsed.credentialType === 'ACCOUNT') {
    const user = await User.findById(parsed.userId).select(
      'username email status membership'
    );
    if (!user || Number(user.membership?.qrVersion || 1) !== parsed.version) {
      throw Object.assign(new Error('Membership QR not found'), { statusCode: 404 });
    }
    if (!user.status) {
      throw Object.assign(new Error('This membership account is inactive'), {
        statusCode: 410,
        code: 'MEMBERSHIP_QR_INACTIVE',
      });
    }
    const entitlements = await MembershipSlotEntitlement.find({
      ownerId: user._id,
      status: { $in: ['active', 'transfer_locked'] },
      expireAt: { $gt: new Date() },
    })
      .populate('packageId', 'name type price')
      .populate('floorId', 'name floorNumber')
      .sort({ expireAt: -1 });
    if (!entitlements.length) {
      throw Object.assign(new Error('This membership has no active parking spaces'), {
        statusCode: 410,
        code: 'MEMBERSHIP_QR_INACTIVE',
      });
    }
    return {
      parsed,
      user,
      userId: user._id,
      credentialId: user._id,
      entitlements,
      subscription: null,
    };
  }

  if (!isEnabled('MEMBERSHIP_LEGACY_QR_ENABLED', true)) {
    throw Object.assign(new Error('This legacy membership QR is no longer accepted'), {
      statusCode: 410,
      code: 'MEMBERSHIP_QR_LEGACY_DISABLED',
    });
  }
  const subscription = await Subscription.findById(parsed.subscriptionId);
  if (!subscription || Number(subscription.qrVersion || 1) !== parsed.version) {
    throw Object.assign(new Error('Membership QR not found'), { statusCode: 404 });
  }
  if (!isMembershipQrAvailable(subscription)) {
    throw Object.assign(
      new Error('This membership has expired and its QR code is no longer valid'),
      { statusCode: 410, code: 'MEMBERSHIP_QR_INACTIVE' }
    );
  }
  const entitlements = await MembershipSlotEntitlement.find({
    sourceSubscriptionId: subscription._id,
    ownerId: subscription.user,
    status: { $in: ['active', 'transfer_locked'] },
    expireAt: { $gt: new Date() },
  })
    .populate('packageId', 'name type price')
    .populate('floorId', 'name floorNumber');
  const user = await User.findById(subscription.user).select(
    'username email status membership'
  );
  return {
    parsed,
    user,
    userId: subscription.user,
    credentialId: subscription._id,
    entitlements,
    subscription,
  };
};

const uploadEvidence = async (base64, credentialId, action) => {
  const result = await cloudinary.uploader.upload(base64, {
    folder: `valo-parking/staff-membership-evidence/${credentialId}`,
    public_id: `${action.toLowerCase()}-${Date.now()}`,
    resource_type: 'image',
  });
  return result.secure_url;
};

exports.resolveMembershipQr = async (req, res, next) => {
  try {
    const verified = await findVerifiedMembership(req.body?.payload);
    const { subscription, entitlements, user, userId, credentialId } = verified;
    if (subscription) {
      await subscription.populate([
        { path: 'user', select: 'username email' },
        { path: 'ticketPackage', select: 'name type' },
        { path: 'slots.floorId', select: 'name floorNumber' },
      ]);
    }
    const entitlementSlots = entitlements.map((entitlement) => ({
      entitlementId: entitlement._id,
      sourceSubscriptionId: entitlement.sourceSubscriptionId,
      floorId: entitlement.floorId,
      slotCode: entitlement.slotCode,
      status: entitlement.status,
      expireAt: entitlement.expireAt,
    }));
    const slots = entitlementSlots.length ? entitlementSlots : subscription?.slots || [];
    const membership = {
      _id: credentialId,
      user: user || subscription.user,
      ticketPackage: entitlements[0]?.packageId || subscription?.ticketPackage || null,
      slots,
      status: 'active',
      expireAt: entitlements[0]?.expireAt || subscription?.expireAt,
      credentialType: verified.parsed.credentialType,
    };
    const [vehicles, activeSessions] = await Promise.all([
      Vehicle.find({ owner: userId, status: 'approved' })
        .select('licensePlate vehicleType brand model color')
        .lean(),
      Session.find({
        userId,
        type: 'SUBSCRIPTION',
        status: 'active',
      })
        .populate('floorId', 'name floorNumber')
        .sort({ checkInTime: -1 })
        .lean(),
    ]);

    const allowedActions = [];
    if (
      vehicles.length > 0 &&
      slots.length > 0 &&
      activeSessions.length < slots.length
    ) {
      allowedActions.push('CHECK_IN');
    }
    if (activeSessions.length > 0) {
      allowedActions.push('CHECK_OUT');
    }

    return res.status(200).json({
      success: true,
      data: {
        credentialType: 'MEMBERSHIP',
        membership,
        vehicles,
        activeSessions,
        allowedActions,
      },
    });
  } catch (error) {
    next(error);
  }
};

exports.transitionMembershipByQr = async (req, res, next) => {
  try {
    const input = validateTransitionBody(req.body);
    if (input.error) {
      return res.status(400).json({ success: false, message: input.error });
    }

    const verified = await findVerifiedMembership(req.body?.payload);
    const { subscription, entitlements, userId, credentialId } = verified;
    if (String(credentialId) !== String(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: 'QR code does not match this membership',
      });
    }

    const existingAction = await StaffSubscriptionAction.findOne({
      staffId: req.user._id,
      idempotencyKey: input.idempotencyKey,
    });
    if (existingAction) {
      if (
        ![
          ...entitlements.map((item) => String(item.sourceSubscriptionId)),
          ...(subscription?._id ? [String(subscription._id)] : []),
        ]
          .includes(String(existingAction.subscriptionId)) ||
        existingAction.action !== input.action
      ) {
        return res.status(409).json({
          success: false,
          message: 'Idempotency key was already used for another staff action',
        });
      }
      const session = await Session.findById(existingAction.sessionId);
      return res.status(200).json({
        success: true,
        idempotent: true,
        message: 'Staff membership action was already completed',
        data: { session },
      });
    }

    let session;
    let vehicle;
    let evidenceImageUrl;

    if (input.action === 'CHECK_IN') {
      vehicle = await Vehicle.findOne({
        _id: req.body.vehicleId,
        owner: userId,
        status: 'approved',
      });
      if (!vehicle) {
        return res.status(404).json({ success: false, message: 'Membership vehicle not found' });
      }

      const floorId = String(req.body.floorId);
      const parkingSlot = normalizeSlotCode(req.body.parkingSlot);
      const entitlement = entitlements.find(
        (item) =>
          String(item.floorId?._id || item.floorId) === floorId &&
          normalizeSlotCode(item.slotCode) === parkingSlot
      );
      const ownsLegacySlot =
        !entitlements.length &&
        subscription?.slots.some(
          (slot) =>
            String(slot.floorId) === floorId &&
            normalizeSlotCode(slot.slotCode) === parkingSlot
        );
      const ownsSlot = Boolean(entitlement || ownsLegacySlot);
      if (!ownsSlot) {
        return res.status(403).json({
          success: false,
          message: 'This parking space is not assigned to the membership',
        });
      }

      const cleanPlate = normalizeLicensePlate(vehicle.licensePlate);
      const [vehicleSession, occupiedSlot] = await Promise.all([
        Session.findOne({ licensePlate: cleanPlate, status: 'active' }),
        Session.findOne({ floorId, parkingSlot, status: 'active' }),
      ]);
      if (vehicleSession) {
        return res.status(409).json({
          success: false,
          message: 'This vehicle already has an active parking session',
        });
      }
      if (occupiedSlot) {
        return res.status(409).json({
          success: false,
          message: 'The selected membership space is currently occupied',
        });
      }

      evidenceImageUrl = await uploadEvidence(
        input.evidenceImageBase64,
        credentialId,
        input.action
      );
      session = await Session.create({
        licensePlate: cleanPlate,
        userId,
        subscriptionId: entitlement?.sourceSubscriptionId || subscription?._id,
        entitlementId: entitlement?._id || null,
        type: 'SUBSCRIPTION',
        source: 'staff_manual',
        vehicleType: vehicle.vehicleType,
        parkingSlot,
        floorId,
        expectedDurationHours: 24,
        entryImage_url: evidenceImageUrl,
        entryCamera: 'staff_mobile',
        entryGate: 'manual_override',
        paymentStatus: 'paid',
        status: 'active',
      });
      aiNotificationEvents.notifySessionCreatedSafely(session, req.app);
    } else {
      session = await Session.findOne({
        _id: req.body.sessionId,
        userId,
        type: 'SUBSCRIPTION',
        status: 'active',
      });
      if (!session) {
        return res.status(404).json({
          success: false,
          message: 'Active membership session not found',
        });
      }

      vehicle = await Vehicle.findOne({
        owner: userId,
        licensePlate: normalizeLicensePlate(session.licensePlate),
      });
      if (!vehicle) {
        return res.status(404).json({
          success: false,
          message: 'Vehicle for this membership session was not found',
        });
      }

      evidenceImageUrl = await uploadEvidence(
        input.evidenceImageBase64,
        credentialId,
        input.action
      );
      const updatedSession = await Session.findOneAndUpdate(
        { _id: session._id, status: 'active' },
        {
          status: 'completed',
          checkOutTime: new Date(),
          totalPrice: 0,
          paymentStatus: 'paid',
          exitImage_url: evidenceImageUrl,
          exitCamera: 'staff_mobile',
          exitGate: 'manual_override',
        },
        { new: true }
      );
      if (!updatedSession) {
        return res.status(409).json({
          success: false,
          message: 'Membership session is no longer active',
        });
      }
      session = updatedSession;
    }

    await StaffSubscriptionAction.create({
      subscriptionId: session.subscriptionId,
      entitlementId: session.entitlementId || null,
      sessionId: session._id,
      staffId: req.user._id,
      action: input.action,
      vehicleId: vehicle._id,
      reason: input.reason,
      evidenceImageUrl,
      idempotencyKey: input.idempotencyKey,
    });

    const notification =
      input.action === 'CHECK_IN'
        ? notifTriggers.notifyVehicleEntry(
            req.app,
            userId,
            vehicle.licensePlate,
            session.parkingSlot || 'N/A'
          )
        : notifTriggers.notifyVehicleExit(
            req.app,
            userId,
            vehicle.licensePlate,
            0
          );
    notification.catch((error) =>
      console.error('Failed to send staff membership notification:', error)
    );

    return res.status(200).json({
      success: true,
      message: `Membership ${input.action === 'CHECK_IN' ? 'check-in' : 'check-out'} completed`,
      data: { session },
    });
  } catch (error) {
    next(error);
  }
};
