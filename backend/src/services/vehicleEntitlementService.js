const { lockOwner, assertNoLegacyConflict } = require('./legacyEntitlementCompatibilityService');
const Vehicle = require('../models/Vehicle');
const Entitlement = require('../models/MembershipSlotEntitlement');
const Subscription = require('../models/Subscription');

const fail = (message) => Object.assign(new Error(message), { statusCode: 409 });

// Every binding mutation writes the same vehicle document in its transaction.
// MongoDB write conflicts serialize purchases, activation, renewal and transfer.
async function lockVehicle({ vehicleId, ownerId, from, until, excludeEntitlementId, excludeSubscriptionId, session }) {
  if (!session?.inTransaction()) throw new Error('Vehicle binding requires a transaction.');
  await lockOwner(ownerId, session);
  await assertNoLegacyConflict({ ownerId, from, until, session });
  const vehicle = await Vehicle.findOneAndUpdate({ _id: vehicleId, owner: ownerId, status: 'approved' },
    { $inc: { entitlementRevision: 1 } }, { new: true, session });
  if (!vehicle) throw fail('Select an approved vehicle that belongs to your account.');
  const overlaps = await Entitlement.exists({
    vehicleId, ...(excludeEntitlementId ? { _id: { $ne: excludeEntitlementId } } : {}),
    status: { $in: ['active', 'transfer_locked', 'pending'] },
    $expr: { $lt: [{ $ifNull: ['$vehicleBindingFrom', '$validFrom'] }, until] }, expireAt: { $gt: from },
  }).session(session);
  const pending = await Subscription.exists({
    'slots.vehicleId': vehicleId, status: 'pending', paymentStatus: 'pending',
    ...(excludeSubscriptionId ? { _id: { $ne: excludeSubscriptionId } } : {}),
  }).session(session);
  if (overlaps || pending) throw fail('This vehicle already has an overlapping entitlement or pending purchase.');
  return vehicle;
}

module.exports = { lockVehicle };
