const Floor = require('../models/ParkingFloor');
const Slot = require('../models/Slot');

const id = (value) => String(value?._id || value || '');
const code = (value) => String(value || '').trim().toUpperCase();
const unavailable = (message, errorCode, operation) => Object.assign(new Error(`${operation} is unavailable: ${message} Please contact parking support.`), { statusCode: 409, code: errorCode });
const inSession = (query, session) => session ? query.session(session) : query;

async function validateMembershipSpace({ floorId, slotId, slotCode, ownerId, entitlementId, subscriptionId }, { session = null, operation = 'Renewal' } = {}) {
  const deny = (message, errorCode) => unavailable(message, errorCode, operation);
  const floor = await inSession(Floor.findById(floorId).select('layoutData'), session);
  if (!floor) throw deny('the referenced parking floor no longer exists.', 'MEMBERSHIP_FLOOR_NOT_FOUND');
  const slot = await inSession(Slot.findById(slotId).select('floorID slotNumber status reservedFor reservedByEntitlementId reservedBySubscriptionId'), session);
  if (!slot) throw deny('the referenced parking space no longer exists.', 'MEMBERSHIP_SLOT_NOT_FOUND');
  if (id(slot.floorID) !== id(floorId) || code(slot.slotNumber) !== code(slotCode)) {
    throw deny('the parking space no longer matches this membership.', 'MEMBERSHIP_SPACE_MISMATCH');
  }
  const layout = (floor.layoutData?.elements || []).filter((element) => String(element.type).startsWith('slot') && element.type !== 'slot-moto' && code(element.name) === code(slotCode));
  if (layout.length !== 1) throw deny('the parking space is missing or ambiguous in its floor layout.', 'MEMBERSHIP_LAYOUT_SLOT_INVALID');
  if (slot.status === 'maintenance') throw deny('the parking space is under maintenance.', 'SLOT_UNDER_MAINTENANCE');
  if (id(slot.reservedFor) !== id(ownerId)
    || (entitlementId && id(slot.reservedByEntitlementId) !== id(entitlementId))
    || (subscriptionId && slot.reservedBySubscriptionId && id(slot.reservedBySubscriptionId) !== id(subscriptionId))) {
    throw deny('the parking space is no longer reserved for this membership owner.', 'MEMBERSHIP_SPACE_OWNERSHIP_MISMATCH');
  }
  return { floor, slot };
}

const validateEntitlementSpace = (entitlement, ownerId, options) => validateMembershipSpace({
  floorId: entitlement.floorId, slotId: entitlement.slotId, slotCode: entitlement.slotCode,
  ownerId, entitlementId: entitlement._id, subscriptionId: entitlement.sourceSubscriptionId,
}, options);

module.exports = { validateMembershipSpace, validateEntitlementSpace };
