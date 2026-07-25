const ParkingFloor = require("../models/ParkingFloor");
const Zone = require("../models/Zone");
const Slot = require("../models/Slot");

// Get all parking floors
exports.getAllFloors = async (req, res) => {
  try {
    const floors = await ParkingFloor.find().sort({ floorNumber: 1 });
    res.status(200).json({ success: true, data: floors });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Create a new floor
exports.createFloor = async (req, res) => {
  try {
    const { floorNumber, name, layoutData } = req.body;
    
    // Default layout structure if not provided
    const initialLayout = layoutData || {
      width: 1000,
      height: 600,
      elements: []
    };

    const newFloor = await ParkingFloor.create({
      floorNumber,
      name,
      layoutData: initialLayout
    });

    const AdminActionLog = require('../models/AdminActionLog');
    await AdminActionLog.create({
      action: "Created Parking Lot",
      target: `${name || `Floor ${floorNumber}`}`,
      type: "create",
      adminId: req.user._id
    });

    res.status(201).json({ success: true, data: newFloor });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ success: false, message: "Floor number already exists" });
    }
    res.status(500).json({ success: false, message: error.message });
  }
};

// Update layout of a specific floor
exports.updateFloorLayout = async (req, res) => {
  try {
    const { id } = req.params;
    const { layoutData } = req.body;

    // Validate layoutData
    if (layoutData && Array.isArray(layoutData.elements)) {
      const elements = layoutData.elements;

      // 1. Process Zones
      const zoneElements = elements.filter(el => el.type === 'zone');
      const zoneDocsMap = {}; // Maps frontend zone.id to MongoDB Zone._id

      for (const zEl of zoneElements) {
        // Upsert Zone
        const zone = await Zone.findOneAndUpdate(
          { floorID: id, zoneName: zEl.name },
          { 
            zoneType: zEl.zoneType || 'standard',
          },
          { new: true, upsert: true }
        );
        // Keep spatial bounds to map slots
        zoneDocsMap[zEl.id] = {
          _id: zone._id,
          x: zEl.x,
          y: zEl.y,
          w: zEl.w,
          h: zEl.h
        };
      }

      // 2. Process Slots & Spatial Mapping
      const slotElements = elements.filter(el => el.type.startsWith('slot'));
      const bulkSlotOps = [];
      const validSlotNames = [];

      for (const sEl of slotElements) {
        // -------------------------------------------------------------
        // OPTIMIZATION: If a parking slot has not been named,
        // do not save it to the database to avoid overload and stale data.
        // The slot remains in layoutData for builder display but cannot be booked.
        // -------------------------------------------------------------
        if (!sEl.name || sEl.name.trim() === '') {
          continue;
        }

        // Find which zone this slot falls into
        let matchedZoneId = null;
        for (const zId in zoneDocsMap) {
          const zBounds = zoneDocsMap[zId];
          // Check if point (sEl.x, sEl.y) is inside rectangle (zBounds)
          if (
            sEl.x >= zBounds.x &&
            sEl.x <= zBounds.x + zBounds.w &&
            sEl.y >= zBounds.y &&
            sEl.y <= zBounds.y + zBounds.h
          ) {
            matchedZoneId = zBounds._id;
            break;
          }
        }

        const slotIdentifier = sEl.name.trim();
        
        if (validSlotNames.includes(slotIdentifier)) {
          return res.status(400).json({ 
            success: false, 
            message: `Error: Duplicate parking slot name "${slotIdentifier}" detected. Slot names must be unique within a floor.`
          });
        }
        
        validSlotNames.push(slotIdentifier);

        // 3. Validation: Every slot MUST belong to a zone
        if (!matchedZoneId) {
          return res.status(400).json({ 
            success: false, 
            message: `Error: Parking slot ${slotIdentifier} is outside every Zone. Please drag this slot into a valid Zone.`
          });
        }

        // Prepare bulk operation for Slot
        bulkSlotOps.push({
          updateOne: {
            filter: { floorID: id, slotNumber: slotIdentifier },
            update: {
              $set: {
                zoneID: matchedZoneId,
                slotType: sEl.type.replace('slot-', '') || 'hourly',
                gridX: sEl.x,
                gridY: sEl.y,
              }
            },
            upsert: true
          }
        });
      }

      // --- 3.5 STRICT PREVENTION: Check if deleted slots have active subscriptions or sessions ---
      const slotsToDelete = await Slot.find({
        floorID: id,
        slotNumber: { $nin: validSlotNames }
      }).select('slotNumber reservedFor reservedByEntitlementId reservedBySubscriptionId');

      if (slotsToDelete.length > 0) {
        const deletedSlotNames = slotsToDelete.map(s => s.slotNumber);
        
        const problematicSlots = new Set(
          slotsToDelete
            .filter(
              (slot) =>
                slot.reservedFor ||
                slot.reservedByEntitlementId ||
                slot.reservedBySubscriptionId
            )
            .map((slot) => slot.slotNumber)
        );

        if (problematicSlots.size > 0) {
           return res.status(400).json({
             success: false, 
             message: `Lỗi Hệ Thống: Không thể xoá các ô đỗ (${Array.from(problematicSlots).join(', ')}) vì khách hàng đang thuê gói VIP tại các ô này. Vui lòng chuyển ô đỗ cho khách trước khi xoá.`
           });
        }
        
        // Check active sessions (Parked Cars)
        const Session = require('../models/Session');
        const activeSessions = await Session.find({
           status: 'active',
           parkingSlot: { $in: deletedSlotNames }
        });
        
        if (activeSessions.length > 0) {
           const problematicSlots = activeSessions.map(s => s.parkingSlot);
           return res.status(400).json({ 
             success: false, 
             message: `Lỗi Hệ Thống: Không thể xoá các ô đỗ (${problematicSlots.join(', ')}) vì đang có xe đậu tại các ô này.`
           });
        }
      }
      // -----------------------------------------------------------------------------------------

      // Execute bulk write for slots
      if (bulkSlotOps.length > 0) {
        await Slot.bulkWrite(bulkSlotOps);
      }

      // 4. Cleanup removed slots
      // Delete any slots in this floor that are not in the validSlotNames list
      await Slot.deleteMany({
        floorID: id,
        slotNumber: { $nin: validSlotNames }
      });
    }

    // Finally, update the Floor's layoutData for frontend rendering
    const floor = await ParkingFloor.findByIdAndUpdate(
      id,
      { layoutData },
      { new: true, runValidators: true }
    );

    if (!floor) {
      return res.status(404).json({ success: false, message: "Floor not found" });
    }

    res.status(200).json({ success: true, data: floor });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Delete a floor
exports.deleteFloor = async (req, res) => {
  try {
    const { id } = req.params;
    const Slot = require('../models/Slot');
    const Zone = require('../models/Zone');

    const floor = await ParkingFloor.findByIdAndDelete(id);

    if (!floor) {
      return res.status(404).json({ success: false, message: "Floor not found" });
    }

    // Đồng bộ xoá tất cả Slot và Zone thuộc về tầng này
    await Slot.deleteMany({ floorID: id });
    await Zone.deleteMany({ floorID: id });

    res.status(200).json({ success: true, message: "Floor and its associated zones and slots deleted successfully" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get all slots for a specific floor
exports.getFloorSlots = async (req, res) => {
  try {
    const { id } = req.params;
    const MembershipSlotEntitlement = require('../models/MembershipSlotEntitlement');

    const slots = await Slot.find({ floorID: id }).populate('zoneID', 'zoneName zoneType').lean();

    const activeEntitlements = await MembershipSlotEntitlement.find({
      floorId: id,
      status: { $in: ['active', 'transfer_locked'] },
      expireAt: { $gt: new Date() },
    })
      .populate('packageId', 'type name price')
      .populate('ownerId', 'username email phone');

    const slotPackageMap = {};
    const slotSubscriptionMap = {};
    activeEntitlements.forEach((entitlement) => {
      slotPackageMap[entitlement.slotCode] = entitlement.packageId?.type || null;
      slotSubscriptionMap[entitlement.slotCode] = {
        _id: entitlement.sourceSubscriptionId,
        entitlementId: entitlement._id,
        status: entitlement.status,
        expireAt: entitlement.expireAt,
        ticketPackage: entitlement.packageId,
        user: entitlement.ownerId,
      };
    });

    const enrichedSlots = slots.map(slot => ({
      ...slot,
      subscriptionType: slotPackageMap[slot.slotNumber] || null,
      subscriptionDetail: slotSubscriptionMap[slot.slotNumber] || null
    }));

    res.status(200).json({ success: true, data: enrichedSlots });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get Live Map Data (Unified slots across all floors with real-time status)
exports.getLiveMapData = async (req, res) => {
  try {
    const Session = require('../models/Session');
    const Booking = require('../models/Booking');
    const BookingHold = require('../models/BookingHold');
    const SlotMaintenanceLog = require('../models/SlotMaintenanceLog');

    const slots = await Slot.find()
      .populate('zoneID', 'zoneName zoneType')
      .populate('floorID', 'name floorNumber');

    const now = new Date();
    const next2Hours = new Date(now.getTime() + 2 * 60 * 60 * 1000);

    const activeSessions = await Session.find({ status: 'active', parkingSlot: { $ne: null } });
    const upcomingBookings = await Booking.find({
      status: { $in: ['PAID', 'PAUSED'] },
      scheduledStart: { $lt: next2Hours },
      scheduledEnd: { $gt: now }
    });
    const activeHolds = await BookingHold.find({ status: 'active', expiresAt: { $gt: now } });
    const maintenanceLogs = await SlotMaintenanceLog.find({
      status: 'in_progress',
      startTime: { $lte: now },
      $or: [{ endTime: { $gte: now } }, { endTime: null }]
    });

    // Hash maps for quick lookup
    const occupiedSlots = new Set(activeSessions.map(s => s.parkingSlot));
    const bookedSlots = new Set(upcomingBookings.map(b => b.parkingSlot));
    const heldSlots = new Set(activeHolds.map(h => h.slotCode));
    const maintenanceSet = new Set(maintenanceLogs.map(m => m.slotNumber));
    const subscriptionSlots = new Set(
      slots
        .filter(
          (slot) =>
            slot.reservedFor ||
            slot.reservedByEntitlementId ||
            slot.reservedBySubscriptionId
        )
        .map((slot) => slot.slotNumber)
    );

    const mapData = slots.map(slot => {
      let status = 'available';
      if (slot.status === 'maintenance' || maintenanceSet.has(slot.slotNumber)) {
        status = 'maintenance';
      } else if (occupiedSlots.has(slot.slotNumber)) {
        status = 'occupied';
      } else if (bookedSlots.has(slot.slotNumber) || heldSlots.has(slot.slotNumber) || subscriptionSlots.has(slot.slotNumber)) {
        status = 'reserved';
      }

      // Map type for frontend
      let type = 'standard';
      if (slot.slotType === 'vip') type = 'vip';
      else if (slot.slotType === 'ev') type = 'ev';
      else if (slot.slotType === 'moto') type = 'moto';

      return {
        id: slot.slotNumber,
        floorId: slot.floorID ? slot.floorID._id : null,
        floorName: slot.floorID ? slot.floorID.name : '',
        zone: slot.zoneID ? slot.zoneID.zoneName : '',
        type,
        status,
        price: type === 'vip' ? '30,000₫/h' : type === 'ev' ? '20,000₫/h + EV' : '10,000₫/h'
      };
    });

    res.status(200).json({ success: true, data: mapData });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
