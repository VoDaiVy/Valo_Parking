const MembershipSlotEntitlement = require('../models/MembershipSlotEntitlement');
const Subscription = require('../models/Subscription');

const normalizeSlotCode = (value) => String(value || '').trim().toUpperCase();

const findActiveSlotOwnership = async ({
  floorId,
  slotCode,
  at = new Date(),
  session = null,
}) => {
  const entitlementQuery = MembershipSlotEntitlement.findOne({
    floorId,
    slotCode: normalizeSlotCode(slotCode),
    validFrom: { $lte: at },
    status: { $in: ['active', 'transfer_locked'] },
    expireAt: { $gt: at },
  }).select('ownerId sourceSubscriptionId slotId expireAt status vehicleId packageSnapshot');
  if (session) entitlementQuery.session(session);
  const entitlement = await entitlementQuery.lean();
  if (entitlement) {
    return {
      ownerId: entitlement.ownerId,
      vehicleId: entitlement.vehicleId,
      service: entitlement.packageSnapshot?.service || 'LEGACY_RESERVED',
      entitlementId: entitlement._id,
      subscriptionId: entitlement.sourceSubscriptionId,
      expireAt: entitlement.expireAt,
      legacy: false,
    };
  }

  const legacyQuery = Subscription.findOne({
    slots: {
      $elemMatch: {
        floorId,
        slotCode: normalizeSlotCode(slotCode),
      },
    },
    bindingVersion: { $ne: 1 },
    status: 'active',
    paymentStatus: 'paid',
    expireAt: { $gt: at },
  }).select('user expireAt');
  if (session) legacyQuery.session(session);
  const subscription = await legacyQuery.lean();
  return subscription
    ? {
        ownerId: subscription.user,
        entitlementId: null,
        subscriptionId: subscription._id,
        expireAt: subscription.expireAt,
        legacy: true,
      }
    : null;
};

module.exports = {
  findActiveSlotOwnership,
};
