const MembershipSlotEntitlement = require('../models/MembershipSlotEntitlement');
const User = require('../models/User');

const ACTIVE_STATUSES = ['active', 'transfer_locked'];

const documentId = (value) => String(value?._id || value || '');
// A dangling populated reference must retain its identity for migration matching.
const preserveFloorReference = (document, originalId) => document || { _id: originalId };

const sourceSlotKey = (sourceSubscriptionId, floorId, slotCode) =>
  [
    documentId(sourceSubscriptionId),
    documentId(floorId),
    String(slotCode || '').trim().toUpperCase(),
  ].join(':');

const getUnmigratedLegacySlots = (
  activeSubscriptions = [],
  sourceEntitlements = []
) => {
  const migratedSourceSlots = new Set(
    sourceEntitlements.map((entitlement) =>
      sourceSlotKey(
        entitlement.sourceSubscriptionId,
        entitlement.floorId,
        entitlement.slotCode
      )
    )
  );

  return activeSubscriptions.flatMap((subscription) =>
    (subscription.slots || [])
      .filter(
        (slot) =>
          !migratedSourceSlots.has(
            sourceSlotKey(subscription._id, slot.floorId, slot.slotCode)
          )
      )
      .map((slot) => ({ subscription, slot }))
  );
};

const deriveMembershipProjection = (entitlements, now = new Date()) => {
  const active = (entitlements || [])
    .filter(
      (item) =>
        ACTIVE_STATUSES.includes(item.status) &&
        item.expireAt &&
        new Date(item.expireAt) > now
    )
    .sort((a, b) => new Date(b.expireAt) - new Date(a.expireAt));

  const latest = active[0] || null;
  return {
    isVip: active.length > 0,
    expireAt: latest ? new Date(latest.expireAt) : null,
    packageId: latest ? latest.packageId || null : null,
  };
};

const recomputeUserMembership = async (userId, options = {}) => {
  const { session = null, rotateQr = false, now = new Date() } = options;
  const query = MembershipSlotEntitlement.find({
    ownerId: userId,
    status: { $in: ACTIVE_STATUSES },
    expireAt: { $gt: now },
  }).select('status expireAt packageId');
  if (session) query.session(session);

  const projection = deriveMembershipProjection(await query.lean(), now);
  const projectionFields = {
    'membership.isVip': projection.isVip,
    'membership.expireAt': projection.expireAt,
    'membership.packageId': projection.packageId,
  };

  const update = rotateQr
    ? [
        {
          $set: {
            ...projectionFields,
            'membership.qrVersion': {
              $add: [{ $ifNull: ['$membership.qrVersion', 1] }, 1],
            },
          },
        },
      ]
    : { $set: projectionFields };
  const updateQuery = User.findByIdAndUpdate(userId, update, { new: true });
  if (session) updateQuery.session(session);
  return updateQuery;
};

module.exports = {
  preserveFloorReference,
  ACTIVE_STATUSES,
  sourceSlotKey,
  getUnmigratedLegacySlots,
  deriveMembershipProjection,
  recomputeUserMembership,
};
