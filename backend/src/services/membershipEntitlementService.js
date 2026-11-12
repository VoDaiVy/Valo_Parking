const { assertNoMembershipBookingConflict } = require('./membershipBookingConflictService');
const { lockOwner } = require('./legacyEntitlementCompatibilityService');
const { lockVehicle } = require('./vehicleEntitlementService');
const MembershipSlotEntitlement = require('../models/MembershipSlotEntitlement');
const Slot = require('../models/Slot');
const { recomputeUserMembership } = require('./membershipProjectionService');

const normalizeSlotCode = (value) => String(value || '').trim().toUpperCase();

const activateSubscriptionEntitlements = async (subscription, options = {}) => {
  const { session = null, rotateQr = true } = options;
  await lockOwner(subscription.user, session);
  const selectedSlots = subscription.slots || [];
  const unitAmount = Math.round(
    Number(subscription.amount || 0) / Math.max(1, selectedSlots.length)
  );
  const entitlements = [];

  for (const selected of selectedSlots) {
    const slotQuery = Slot.findOne({
      floorID: selected.floorId,
      slotNumber: normalizeSlotCode(selected.slotCode),
    });
    if (session) slotQuery.session(session);
    const slot = await slotQuery;
    if (!slot) {
      throw Object.assign(new Error(`Slot ${selected.slotCode} no longer exists.`), {
        code: 'SLOT_NOT_FOUND',
        statusCode: 404,
      });
    }
    const previous = await MembershipSlotEntitlement.findOne({
      sourceSubscriptionId: subscription._id, slotId: slot._id,
    }).session(session);
    if (previous) {
      entitlements.push(previous);
      continue;
    }

    // Provider payment may arrive after the initial quote. Recheck the actual
    // activation interval before creating rights; paid conflicts reconcile in
    // subscriptionController.verifyPayment without a second charge.
    await assertNoMembershipBookingConflict({ floorId: selected.floorId,
      slotCode: selected.slotCode, validFrom: subscription.validFrom || subscription.createdAt,
      expireAt: subscription.expireAt, session });

    const legacyReservation = subscription.bindingVersion !== 1 && String(slot.reservedFor) === String(subscription.user)
      && !slot.reservedByEntitlementId && (!slot.reservedBySubscriptionId || String(slot.reservedBySubscriptionId) === String(subscription._id));
    if (!legacyReservation && (slot.reservedFor || slot.reservedByEntitlementId || (slot.reservedBySubscriptionId && String(slot.reservedBySubscriptionId) !== String(subscription._id)) || slot.status !== 'available')) {
      throw Object.assign(new Error(`Slot ${selected.slotCode} is already reserved.`), {
        code: 'SLOT_ALREADY_RESERVED',
        statusCode: 409,
      });
    }

    // A delayed legacy activation must not create shared rights over a newly bound vehicle.
    // Already-created legacy entitlements return above and retain their original rights.
    if (subscription.bindingVersion !== 1 && !selected.vehicleId) {
      const bound = await MembershipSlotEntitlement.exists({ ownerId: subscription.user,
        vehicleId: { $ne: null }, status: { $in: ['active', 'transfer_locked', 'pending'] },
        expireAt: { $gt: subscription.validFrom }, validFrom: { $lt: subscription.expireAt },
      }).session(session);
      if (bound) throw Object.assign(new Error('Legacy activation overlaps a vehicle-bound entitlement and requires reconciliation. Existing rights are unchanged.'), { statusCode: 409, code: 'LEGACY_SHARED_ENTITLEMENT_CONFLICT' });
    }

    if (subscription.bindingVersion === 1) {
      await lockVehicle({ vehicleId: selected.vehicleId, ownerId: subscription.user,
        from: subscription.validFrom, until: subscription.expireAt,
        excludeSubscriptionId: subscription._id, session });
    }

    const entitlement = await MembershipSlotEntitlement.findOneAndUpdate(
      { sourceSubscriptionId: subscription._id, slotId: slot._id },
      {
        $setOnInsert: {
          vehicleId: selected.vehicleId,
          vehicleBindingFrom: selected.vehicleId ? subscription.validFrom : undefined,
          transferCount: 0,
          packageSnapshot: subscription.packageSnapshot,
          ownerId: subscription.user,
          floorId: selected.floorId,
          slotCode: normalizeSlotCode(selected.slotCode),
          packageId: subscription.ticketPackage,
          validFrom: subscription.validFrom || subscription.createdAt || new Date(),
          expireAt: subscription.expireAt,
          status: 'active',
          unitAmount,
        },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true, session }
    );
    if (!entitlement.lineageRootId) {
      entitlement.lineageRootId = entitlement._id;
      await entitlement.save({ session });
    }

    const slotResult = await Slot.updateOne(
      {
        _id: slot._id,
        ...(legacyReservation ? { reservedFor: subscription.user } : { status: 'available', reservedFor: null }), reservedByEntitlementId: null,
        $or: [{ reservedBySubscriptionId: null }, { reservedBySubscriptionId: subscription._id }],
      },
      {
        $set: {
          reservedFor: subscription.user,
          reservedBySubscriptionId: subscription._id,
          reservedByEntitlementId: entitlement._id,
          reservedUntil: subscription.expireAt,
        },
      },
      { session }
    );
    if (slotResult.matchedCount !== 1) {
      throw Object.assign(new Error(`Slot ${selected.slotCode} ownership changed.`), {
        code: 'SLOT_OWNERSHIP_CHANGED',
        statusCode: 409,
      });
    }
    
    // Purchases apply to subsequent check-ins. Existing sessions and bookings
    // keep their original payment and pricing context.

    entitlements.push(entitlement);
  }

  await recomputeUserMembership(subscription.user, { session, rotateQr });
  return entitlements;
};

module.exports = {
  activateSubscriptionEntitlements,
  normalizeSlotCode,
};
