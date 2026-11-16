const ParkingFloor = require('../models/ParkingFloor');
const Slot = require('../models/Slot');
const Session = require('../models/Session');
const Booking = require('../models/Booking');
const BookingHold = require('../models/BookingHold');
const MembershipSlotEntitlement = require('../models/MembershipSlotEntitlement');

const normalizeSlotCode = (code = '') => String(code || '').trim().toUpperCase();

const getParkingCapacitySnapshot = async (now = new Date()) => {
  const floors = await ParkingFloor.find({ status: { $ne: 'archived' } }).lean();
  const configuredSlots = new Set();

  for (const floor of floors) {
    let layout = floor.layoutData;
    if (typeof layout === 'string') {
      try {
        layout = JSON.parse(layout);
      } catch {
        layout = null;
      }
    }
    for (const element of layout?.elements || []) {
      if (
        element.type &&
        element.type.startsWith('slot') &&
        element.name
      ) {
        configuredSlots.add(`${floor._id}:${normalizeSlotCode(element.name)}`);
      }
    }
  }

  // Fallback to Slot collection if no layoutData configured
  if (configuredSlots.size === 0) {
    const slotDocuments = await Slot.find({ retired: { $ne: true } }).select('floorID slotNumber').lean();
    slotDocuments.forEach((slot) => {
      if (slot.floorID && slot.slotNumber) {
        configuredSlots.add(`${slot.floorID}:${normalizeSlotCode(slot.slotNumber)}`);
      }
    });
  }

  const occupiedSlots = new Set();
  let unassignedCount = 0;
  const addSlotOrUnassigned = (floorId, slotCode) => {
    const key = floorId && slotCode
      ? `${floorId}:${normalizeSlotCode(slotCode)}`
      : null;
    if (key && configuredSlots.has(key)) {
      occupiedSlots.add(key);
    } else if (key) {
      unassignedCount += 1;
    }
  };

  const next30Min = new Date(now.getTime() + 30 * 60 * 1000);

  const [activeSessions, activeBookings, activeHolds, blockedSlots, activeVipEntitlements] = await Promise.all([
    Session.find({ status: 'active' }).select('floorId parkingSlot').lean(),
    Booking.find({
      status: { $in: ['PAID', 'PAUSED', 'ACTIVE'] },
      scheduledStart: { $lte: next30Min },
      scheduledEnd: { $gte: now },
    }).select('floorId parkingSlot').lean(),
    BookingHold.find({ status: 'active', expiresAt: { $gt: now } }).select('floorId slotCode').lean(),
    Slot.find({
      retired: { $ne: true },
      $or: [
        { status: { $in: ['maintenance', 'occupied'] } },
        { 'aiObservation.occupied': true },
      ],
    }).select('floorID slotNumber status aiObservation').lean(),
    MembershipSlotEntitlement.find({
      status: { $in: ['active', 'transfer_locked'] },
      expireAt: { $gt: now },
    }).select('floorId slotCode').lean(),
  ]);

  activeSessions.forEach((item) => addSlotOrUnassigned(item.floorId, item.parkingSlot));
  activeBookings.forEach((item) => addSlotOrUnassigned(item.floorId, item.parkingSlot));
  activeHolds.forEach((item) => addSlotOrUnassigned(item.floorId, item.slotCode));
  blockedSlots.forEach((item) => addSlotOrUnassigned(item.floorID, item.slotNumber));

  const totalSlots = configuredSlots.size;
  const occupiedCount = occupiedSlots.size + unassignedCount;
  const availableSlots = Math.max(0, totalSlots - occupiedCount);

  // Additional detail breakdowns
  const maintenanceCount = blockedSlots.filter(s => s.status === 'maintenance').length;
  const vipReservedCount = activeVipEntitlements.length;

  return {
    totalSlots,
    occupiedSlots: occupiedCount,
    availableSlots,
    maintenanceSlots: maintenanceCount,
    vipReservedSlots: vipReservedCount,
    isFull: availableSlots <= 0 && totalSlots > 0,
  };
};

module.exports = {
  getParkingCapacitySnapshot,
  normalizeSlotCode,
};
