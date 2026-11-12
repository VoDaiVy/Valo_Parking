const Slot = require('../models/Slot');
const Entitlement = require('../models/MembershipSlotEntitlement');
const Subscription = require('../models/Subscription');
const Vehicle = require('../models/Vehicle');
const { normalizeLicensePlate } = require('../utils/licensePlateUtils');

const id = (value) => String(value?._id || value || '');
const deny = (message, code, statusCode = 409) => Object.assign(new Error(message), { code, statusCode });

// Lock the physical slot before reading rights. Activation/transfer also write this
// document, so transactions cannot commit authorization against stale ownership.
async function checkReservation({ floorId, slotCode, userId, vehicleId, licensePlate,
  at = new Date(), end = null, purpose = 'entry', session = null }) {
  if (!floorId || !slotCode) return null;
  floorId = floorId?._id || floorId;
  slotCode = String(slotCode).trim().toUpperCase();
  const slot = session
    ? await Slot.findOneAndUpdate({ floorID: floorId, slotNumber: slotCode },
      { $inc: { __v: 1 } }, { new: true, session })
    : await Slot.findOne({ floorID: floorId, slotNumber: slotCode }).lean();
  if (!slot) throw deny('The parking slot no longer exists.', 'RESERVATION_SLOT_NOT_FOUND');
  const from = new Date(at);
  const until = end ? new Date(end) : from;
  const validity = { validFrom: end ? { $lt: until } : { $lte: from }, expireAt: { $gt: from } };
  const rights = await Entitlement.find({ floorId, slotCode,
    status: { $in: ['active', 'transfer_locked'] }, ...validity }).session(session).lean();
  // Never resurrect a migrated (including transferred/cancelled) source slot.
  const sources = await Entitlement.find({ floorId, slotCode }).select('sourceSubscriptionId').session(session).lean();
  const legacy = await Subscription.find({ _id: { $nin: sources.map(e => e.sourceSubscriptionId) },
    bindingVersion: { $ne: 1 }, status: 'active', paymentStatus: 'paid',
    expireAt: { $gt: from }, $or: [{ validFrom: validity.validFrom }, { validFrom: null }],
    slots: { $elemMatch: { floorId, slotCode } },
  }).session(session).lean();
  const reservations = [...rights.map(e => ({ ownerId: e.ownerId, vehicleId: e.vehicleId,
    entitlementId: e._id, slotId: e.slotId, subscriptionId: e.sourceSubscriptionId })),
    ...legacy.map(s => ({ ownerId: s.user, subscriptionId: s._id,
      vehicleId: s.slots.find(v => id(v.floorId) === id(floorId) && v.slotCode === slotCode)?.vehicleId }))];
  for (const reservation of reservations) {
    if (reservation.slotId && id(reservation.slotId) !== id(slot._id)) {
      throw deny('The reservation does not match this parking slot. Contact parking support.', 'SLOT_RESERVATION_INCONSISTENT');
    }
    if (session) {
      // Serialize against expiry, transfer and cancellation even if their slot
      // update is deferred. These counters do not change purchased benefits.
      if (reservation.entitlementId) {
        await Entitlement.updateOne({ _id: reservation.entitlementId }, { $inc: { usageRevision: 1 } }, { session });
      } else {
        await Subscription.updateOne({ _id: reservation.subscriptionId }, { $inc: { __v: 1 } }, { session });
      }
    }
    if (!userId || id(reservation.ownerId) !== id(userId)) {
      throw deny('This slot is reserved for another customer.', 'SLOT_RESERVATION_OWNER_MISMATCH', 403);
    }
    // Legacy shared rights still require an approved vehicle owned by the customer.
    const vehicleFilter = { owner: reservation.ownerId, status: 'approved',
      ...(reservation.vehicleId ? { _id: reservation.vehicleId } : vehicleId ? { _id: vehicleId } : {}),
      ...(licensePlate ? { licensePlate: normalizeLicensePlate(licensePlate) } : {}),
    };
    const vehicle = session
      ? await Vehicle.findOneAndUpdate(vehicleFilter, { $inc: { entitlementRevision: 1 } }, { new: true, session }).lean()
      : await Vehicle.findOne(vehicleFilter).lean();
    if ((!vehicleId && !licensePlate) || !vehicle
      || (vehicleId && id(vehicle._id) !== id(vehicleId))) {
      throw deny('This slot is reserved for a different approved vehicle.', 'SLOT_RESERVATION_VEHICLE_MISMATCH', 403);
    }
    if (reservation.vehicleId && purpose === 'booking') {
      throw deny('Use membership check-in for this vehicle-bound reserved space.', 'MEMBERSHIP_CHECK_IN_REQUIRED');
    }
  }
  return reservations[0] || null;
}

async function authorizeSlotReservation(options) {
  try {
    return await checkReservation(options);
  } catch (error) {
    if (error.hasErrorLabel?.('TransientTransactionError')) {
      error.statusCode = 409;
      error.message = 'The slot reservation changed concurrently. Please retry.';
    }
    throw error;
  }
}

module.exports = { authorizeSlotReservation };
