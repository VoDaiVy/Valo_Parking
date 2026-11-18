const User = require('../models/User');
const Entitlement = require('../models/MembershipSlotEntitlement');
const Subscription = require('../models/Subscription');
const { getUnmigratedLegacySlots } = require('./membershipProjectionService');

const MESSAGE = 'An active legacy shared parking entitlement overlaps this purchase or transfer. You can obtain a vehicle-bound reserved space after the legacy entitlement expires.';

// All binding/legacy activation paths write the owner document before reading rights.
async function lockOwner(ownerId, session) {
  if (!session?.inTransaction()) throw new Error('Entitlement compatibility requires a transaction.');
  const result = await User.updateOne({ _id: ownerId }, { $inc: { __v: 1 } }, { session });
  if (!result.matchedCount) throw Object.assign(new Error('Customer account not found.'), { statusCode: 404 });
}

async function legacyConflict({ ownerId, from = new Date(), until = new Date(8640000000000000), session = null }) {
  const read = (query) => query.session(session).lean();
  const overlap = { expireAt: { $gt: from }, $expr: { $lt: [{ $ifNull: ['$validFrom', { $ifNull: ['$createdAt', new Date(0)] }] }, until] } };
  const shared = await read(Entitlement.find({ ownerId, vehicleId: null,
    status: { $in: ['active', 'transfer_locked'] }, ...overlap,
  }).select('expireAt'));
  const subscriptions = await read(Subscription.find({ user: ownerId, status: 'active', paymentStatus: 'paid',
    ...overlap }).select('slots expireAt'));
  const sources = subscriptions.length ? await read(Entitlement.find({
    sourceSubscriptionId: { $in: subscriptions.map((item) => item._id) },
  }).select('sourceSubscriptionId floorId slotCode')) : [];
  const legacy = getUnmigratedLegacySlots(subscriptions, sources).filter(({ slot }) => !slot.vehicleId);
  const expirations = [...shared.map((item) => item.expireAt), ...legacy.map(({ subscription }) => subscription.expireAt)];
  return expirations.length ? { code: 'LEGACY_SHARED_ENTITLEMENT_CONFLICT', reason: MESSAGE,
    blockedUntil: new Date(Math.max(...expirations.map((date) => new Date(date).getTime()))) } : null;
}

async function assertNoLegacyConflict(options) {
  const conflict = await legacyConflict(options);
  if (conflict) throw Object.assign(new Error(conflict.reason), { code: conflict.code, statusCode: 409 });
}
module.exports = { lockOwner, legacyConflict, assertNoLegacyConflict };
