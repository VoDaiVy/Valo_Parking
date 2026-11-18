const Booking = require('../models/Booking');
const BookingHold = require('../models/BookingHold');
const Session = require('../models/Session');
const Slot = require('../models/Slot');
const SlotMaintenanceLog = require('../models/SlotMaintenanceLog');

function buildLiveParkingMap({ slots, activeSessions, upcomingBookings, activeHolds, maintenanceLogs, now }) {
  const slotKey = (floorId, slotCode) => `${String(floorId || '')}:${String(slotCode || '').trim().toUpperCase()}`;
  const occupiedSlots = new Set(activeSessions.map(s => slotKey(s.floorId, s.parkingSlot)));
  const bookedSlots = new Set(upcomingBookings.map(b => slotKey(b.floorId, b.parkingSlot)));
  const heldSlots = new Set(activeHolds.map(h => slotKey(h.floorId, h.slotCode)));
  const maintenanceSet = new Set(maintenanceLogs.map(m => String(m.slotID || '')));

  return slots.map(slot => {
    let status = 'available';
    const currentSlotKey = slotKey(slot.floorID?._id || slot.floorID, slot.slotNumber);
    const isPhysicallyOccupied = Boolean(slot.aiObservation?.occupied);
    const entitlement = slot.reservedByEntitlementId;
    const hasDedicatedPass = Boolean(slot.reservedFor?._id || (
      entitlement?.ownerId && ['active', 'transfer_locked'].includes(entitlement.status)
      && new Date(entitlement.expireAt) > now
    ));

    if (slot.status === 'maintenance' || maintenanceSet.has(String(slot._id))) {
      status = 'maintenance';
    } else if (occupiedSlots.has(currentSlotKey) || slot.status === 'occupied' || isPhysicallyOccupied) {
      status = 'occupied';
    } else if (bookedSlots.has(currentSlotKey) || heldSlots.has(currentSlotKey) || hasDedicatedPass) {
      status = 'reserved';
    }

    const slotType = String(slot.slotType || '').toLowerCase().replace(/^slot-/, '');
    const type = ['vip', 'ev', 'moto', 'handicap'].includes(slotType) ? slotType : 'standard';

    const acceptsBookings = Boolean(slot.floorID && slot.floorID.acceptsBookings !== false
      && !['draft', 'archived'].includes(slot.floorID.status));
    let availabilityReason = status;
    if (status === 'reserved') {
      availabilityReason = hasDedicatedPass || type === 'vip' ? 'dedicated'
        : bookedSlots.has(currentSlotKey) ? 'booked' : 'held';
    } else if (status === 'available') {
      if (!acceptsBookings || slot.retired) availabilityReason = 'closed';
      else if (type === 'vip') availabilityReason = 'dedicated';
    }

    return {
      id: slot.slotNumber,
      floorId: slot.floorID ? slot.floorID._id : null,
      floorName: slot.floorID ? slot.floorID.name : '',
      floorNumber: slot.floorID?.floorNumber,
      zone: slot.zoneID ? slot.zoneID.zoneName : '',
      type,
      status,
      availabilityReason,
      acceptsBookings,
      retired: Boolean(slot.retired),
      detectedPlate: slot.aiObservation?.detectedPlate || null,
      isViolation: Boolean(slot.aiObservation?.isViolation),
      violationType: slot.aiObservation?.violationType || null,
      price: type === 'vip' ? '30,000₫/h' : type === 'ev' ? '20,000₫/h + EV' : '10,000₫/h'
    };
  });
}

async function getLiveParkingMap(now = new Date()) {
  const upcoming = new Date(now.getTime() + 2 * 60 * 60 * 1000);
  const [slots, activeSessions, upcomingBookings, activeHolds, maintenanceLogs] = await Promise.all([
    Slot.find()
      .select('slotNumber slotType status retired zoneID floorID reservedFor reservedByEntitlementId aiObservation.occupied aiObservation.detectedPlate aiObservation.isViolation aiObservation.violationType')
      .populate('zoneID', 'zoneName zoneType')
      .populate('floorID', 'name floorNumber status acceptsBookings')
      .populate('reservedFor', '_id')
      .populate('reservedByEntitlementId', 'ownerId status expireAt')
      .lean(),
    Session.find({ status: 'active', parkingSlot: { $ne: null } }).select('floorId parkingSlot').lean(),
    Booking.find({
      status: { $in: ['PAID', 'ACTIVE', 'PAUSED'] },
      scheduledStart: { $lt: upcoming },
      scheduledEnd: { $gt: now },
    }).select('floorId parkingSlot').lean(),
    BookingHold.find({
      status: 'active',
      expiresAt: { $gt: now },
      startTime: { $lt: upcoming },
      endTime: { $gt: now },
    }).select('floorId slotCode').lean(),
    SlotMaintenanceLog.find({
      startTime: { $lte: now },
      $or: [{ endTime: { $gte: now } }, { endTime: null }],
    }).select('slotID').lean(),
  ]);

  return buildLiveParkingMap({ slots, activeSessions, upcomingBookings, activeHolds, maintenanceLogs, now });
}

module.exports = { getLiveParkingMap };
