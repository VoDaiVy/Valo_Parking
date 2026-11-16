const Slot = require('../models/Slot');
const Session = require('../models/Session');
const Booking = require('../models/Booking');
const BookingHold = require('../models/BookingHold');
const MembershipSlotEntitlement = require('../models/MembershipSlotEntitlement');
const SlotMaintenanceLog = require('../models/SlotMaintenanceLog');

async function getVipFloorAvailability(floorId, now = new Date()) {
  const slotsPromise = Promise.resolve(Slot.find({ floorID: floorId, retired: { $ne: true } })
    .select('_id floorID slotNumber slotType status reservedFor reservedBySubscriptionId reservedByEntitlementId aiObservation.occupied').lean());
  const maintenancePromise = slotsPromise.then((slots) => SlotMaintenanceLog.find({
    slotID: { $in: slots.map((slot) => slot._id) }, startTime: { $lte: now },
    $or: [{ endTime: { $gte: now } }, { endTime: null }],
  }).select('slotID').lean());
  const [slots, sessions, bookings, holds, entitlements, maintenance] = await Promise.all([
    slotsPromise,
    Session.find({ floorId, status: 'active', parkingSlot: { $ne: null } }).select('parkingSlot').lean(),
    Booking.find({ floorId, status: { $in: ['PAID', 'ACTIVE', 'PAUSED'] },
      scheduledStart: { $lt: new Date(now.getTime() + 2 * 60 * 60 * 1000) }, scheduledEnd: { $gt: now } }).select('parkingSlot').lean(),
    BookingHold.find({ floorId, status: 'active', expiresAt: { $gt: now } }).select('slotCode').lean(),
    MembershipSlotEntitlement.find({ floorId, status: { $in: ['active', 'transfer_locked'] },
      expireAt: { $gt: now }, ownerId: { $ne: null } }).select('slotCode').lean(),
    maintenancePromise,
  ]);
  const code = (value) => String(value || '').trim().toUpperCase();
  const occupied = new Set(sessions.map((item) => code(item.parkingSlot)));
  const reserved = new Set([...bookings.map((item) => code(item.parkingSlot)), ...holds.map((item) => code(item.slotCode))]);
  const memberships = new Set(entitlements.map((item) => code(item.slotCode)));
  const maintained = new Set(maintenance.map((item) => String(item.slotID)));
  return { floorId, checkedAt: now.toISOString(), slots: slots.map((slot) => {
    const slotNumber = code(slot.slotNumber);
    const membershipReserved = Boolean(slot.reservedFor || slot.reservedBySubscriptionId || slot.reservedByEntitlementId || memberships.has(slotNumber));
    const status = slot.status === 'maintenance' || maintained.has(String(slot._id)) ? 'maintenance'
      : slot.status === 'occupied' || slot.aiObservation?.occupied || occupied.has(slotNumber) ? 'occupied'
        : membershipReserved || slot.status === 'booked' || reserved.has(slotNumber) ? 'booked' : 'available';
    return { _id: slot._id, floorID: floorId, slotNumber, slotType: slot.slotType, status,
      subscriptionType: membershipReserved ? 'reserved' : null, isAvailable: status === 'available' };
  }) };
}

module.exports = { getVipFloorAvailability };
