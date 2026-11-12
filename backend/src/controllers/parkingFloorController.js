const ParkingFloor = require("../models/ParkingFloor");
const Zone = require("../models/Zone");
const Slot = require("../models/Slot");
const Session = require("../models/Session");
const Booking = require("../models/Booking");
const MembershipSlotEntitlement = require("../models/MembershipSlotEntitlement");
const AdminActionLog = require("../models/AdminActionLog");

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
    const { floorNumber, name, code, layoutData } = req.body;
    
    // Default layout structure if not provided
    const initialLayout = layoutData || {
      width: 1000,
      height: 600,
      elements: []
    };

    const parsedFloorNumber = Number(floorNumber);
    if (isNaN(parsedFloorNumber) || parsedFloorNumber < 1) {
      return res.status(400).json({ success: false, message: "Số tầng không hợp lệ (phải là số nguyên dương >= 1)." });
    }

    const existingFloor = await ParkingFloor.findOne({ floorNumber: parsedFloorNumber });
    if (existingFloor) {
      return res.status(400).json({ success: false, message: `Tầng ${parsedFloorNumber} đã tồn tại trong hệ thống.` });
    }

    const floorName = name || `Floor ${parsedFloorNumber}`;
    const floorCode = (code || `F${parsedFloorNumber}`).toUpperCase();

    const newFloor = await ParkingFloor.create({
      floorNumber: parsedFloorNumber,
      name: floorName,
      code: floorCode,
      layoutData: initialLayout
    });

    if (req.user?._id) {
      await AdminActionLog.create({
        action: "Created Parking Lot",
        target: floorName,
        type: "create",
        adminId: req.user._id
      });
    }

    res.status(201).json({ success: true, data: newFloor });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ success: false, message: "Số tầng hoặc mã tầng đã tồn tại." });
    }
    res.status(500).json({ success: false, message: error.message });
  }
};

// Update metadata of a floor (name, floorNumber, code)
exports.updateFloorInfo = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, floorNumber, code } = req.body;

    const floor = await ParkingFloor.findById(id);
    if (!floor) {
      return res.status(404).json({ success: false, message: "Không tìm thấy tầng." });
    }

    if (floorNumber !== undefined) {
      const parsed = Number(floorNumber);
      if (isNaN(parsed) || parsed < 1) {
        return res.status(400).json({ success: false, message: "Số tầng phải là số nguyên dương >= 1." });
      }
      const duplicate = await ParkingFloor.findOne({ floorNumber: parsed, _id: { $ne: id } });
      if (duplicate) {
        return res.status(400).json({ success: false, message: `Số tầng ${parsed} đã tồn tại.` });
      }
      floor.floorNumber = parsed;
    }

    if (name) floor.name = name.trim();
    if (code) floor.code = code.trim().toUpperCase();

    await floor.save();

    if (req.user?._id) {
      await AdminActionLog.create({
        action: "Updated Parking Floor Info",
        target: `${floor.name} (Tầng ${floor.floorNumber})`,
        type: "update",
        adminId: req.user._id
      });
    }

    res.status(200).json({ success: true, data: floor });
  } catch (error) {
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
        if (!sEl.name || sEl.name.trim() === '') {
          continue;
        }

        // Find which zone this slot falls into
        let matchedZoneId = null;
        for (const zId in zoneDocsMap) {
          const zBounds = zoneDocsMap[zId];
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
            message: `Lỗi: Phát hiện trùng tên ô đỗ "${slotIdentifier}". Tên ô đỗ phải duy nhất trong một tầng.`
          });
        }
        
        validSlotNames.push(slotIdentifier);

        // 3. Validation: Every slot MUST belong to a zone
        if (!matchedZoneId) {
          return res.status(400).json({ 
            success: false, 
            message: `Lỗi: Ô đỗ "${slotIdentifier}" nằm ngoài tất cả các Zone. Vui lòng kéo ô vào bên trong một Zone hợp lệ.`
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

      // --- 3.5 STRICT PREVENTION: Check if deleted slots have active dependencies ---
      const existingSlots = await Slot.find({ floorID: id });
      const slotsToDelete = existingSlots.filter(s => !validSlotNames.includes(s.slotNumber));

      if (slotsToDelete.length > 0) {
        const slotIdsToDelete = slotsToDelete.map(s => s._id);
        const slotNamesToDelete = slotsToDelete.map(s => s.slotNumber);

        // A. Check active sessions (cars currently parked)
        const activeSessions = await Session.find({
          status: 'active',
          $or: [
            { parkingSlot: { $in: slotNamesToDelete } },
            { floorId: id, parkingSlot: { $in: slotNamesToDelete } }
          ]
        });

        if (activeSessions.length > 0) {
          const busySlots = [...new Set(activeSessions.map(s => s.parkingSlot))].join(', ');
          return res.status(400).json({
            success: false,
            message: `Không thể lưu sơ đồ! Các ô [${busySlots}] đang có xe đỗ thực tế. Vui lòng giữ lại các ô này.`
          });
        }

        // B. Check active VIP entitlements
        const activeEntitlements = await MembershipSlotEntitlement.find({
          slotId: { $in: slotIdsToDelete },
          status: { $in: ['active', 'transfer_locked'] },
          expireAt: { $gt: new Date() }
        });

        if (activeEntitlements.length > 0) {
          const vipSlots = [...new Set(activeEntitlements.map(e => e.slotCode))].join(', ');
          return res.status(400).json({
            success: false,
            message: `Không thể xoá các ô VIP [${vipSlots}] vì khách hàng đang sở hữu gói thuê hiệu lực.`
          });
        }

        // C. Check upcoming / active bookings
        const activeBookings = await Booking.find({
          parkingSlot: { $in: slotNamesToDelete },
          floorId: id,
          status: { $in: ['PAID', 'PENDING', 'ACTIVE'] },
          scheduledEnd: { $gte: new Date() }
        });

        if (activeBookings.length > 0) {
          const bookedSlots = [...new Set(activeBookings.map(b => b.parkingSlot))].join(', ');
          return res.status(400).json({
            success: false,
            message: `Không thể xoá các ô [${bookedSlots}] vì đang có lịch đặt chỗ chưa kết thúc.`
          });
        }
      }

      if (bulkSlotOps.length > 0) {
        await Slot.bulkWrite(bulkSlotOps);
      }

      // Delete any slots in this floor that are not in validSlotNames
      await Slot.deleteMany({
        floorID: id,
        slotNumber: { $nin: validSlotNames }
      });
    }

    // Update the Floor's layoutData
    const floor = await ParkingFloor.findByIdAndUpdate(
      id,
      { layoutData },
      { new: true, runValidators: true }
    );

    if (!floor) {
      return res.status(404).json({ success: false, message: "Không tìm thấy tầng." });
    }

    res.status(200).json({ success: true, data: floor });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Delete a floor with strict safeguards
exports.deleteFloor = async (req, res) => {
  try {
    const { id } = req.params;

    const floor = await ParkingFloor.findById(id);
    if (!floor) {
      return res.status(404).json({ success: false, message: "Không tìm thấy tầng." });
    }

    // 1. Safeguard: Check active parking sessions
    const activeSessionsCount = await Session.countDocuments({
      floorId: id,
      status: 'active'
    });
    if (activeSessionsCount > 0) {
      return res.status(400).json({
        success: false,
        message: `Không thể xoá ${floor.name}! Tầng này đang có ${activeSessionsCount} xe đang đỗ thực tế.`
      });
    }

    // 2. Safeguard: Check active VIP entitlements
    const activeVipCount = await MembershipSlotEntitlement.countDocuments({
      floorId: id,
      status: { $in: ['active', 'transfer_locked'] },
      expireAt: { $gt: new Date() }
    });
    if (activeVipCount > 0) {
      return res.status(400).json({
        success: false,
        message: `Không thể xoá ${floor.name}! Tầng này đang có ${activeVipCount} slot VIP của khách hàng đang hiệu lực.`
      });
    }

    // 3. Safeguard: Check upcoming bookings
    const activeBookingCount = await Booking.countDocuments({
      floorId: id,
      status: { $in: ['PAID', 'PENDING', 'ACTIVE'] },
      scheduledEnd: { $gte: new Date() }
    });
    if (activeBookingCount > 0) {
      return res.status(400).json({
        success: false,
        message: `Không thể xoá ${floor.name}! Tầng này đang có ${activeBookingCount} lịch đặt trước sắp diễn ra.`
      });
    }

    // Safe to delete
    await ParkingFloor.findByIdAndDelete(id);
    await Slot.deleteMany({ floorID: id });
    await Zone.deleteMany({ floorID: id });

    if (req.user?._id) {
      await AdminActionLog.create({
        action: "Deleted Parking Floor",
        target: `${floor.name} (Tầng ${floor.floorNumber})`,
        type: "delete",
        adminId: req.user._id
      });
    }

    res.status(200).json({ success: true, message: `Đã xoá ${floor.name} cùng toàn bộ ô đỗ liên quan thành công.` });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get all slots for a specific floor
exports.getFloorSlots = async (req, res) => {
  try {
    const { id } = req.params;
    const SlotMaintenanceLog = require('../models/SlotMaintenanceLog');

    const slots = await Slot.find({ floorID: id })
      .select('-aiObservation.fullSnapshot')
      .populate('zoneID', 'zoneName zoneType')
      .lean();

    const [rawEntitlements, activeMaintenanceLogs] = await Promise.all([
      MembershipSlotEntitlement.find({
        floorId: id,
        status: { $in: ['active', 'transfer_locked'] },
        expireAt: { $gt: new Date() },
      })
        .populate('packageId', 'type name price')
        .populate('ownerId', 'username email phone'),
      SlotMaintenanceLog.find({
        slotID: { $in: slots.map(s => s._id) },
        $or: [{ endTime: { $gte: new Date() } }, { endTime: null }]
      }).select('slotID').lean()
    ]);
      
    // Filter orphaned entitlements
    const activeEntitlements = rawEntitlements.filter(e => e.ownerId);
    const maintenanceSet = new Set(activeMaintenanceLogs.map(m => String(m.slotID)));

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

    const enrichedSlots = slots.map(slot => {
      const isPhysicallyOccupied = Boolean(slot.aiObservation?.occupied);
      const isUnderMaintenance = slot.status === 'maintenance' || maintenanceSet.has(String(slot._id));
      let resolvedStatus = slot.status;
      if (isUnderMaintenance) {
        resolvedStatus = 'maintenance';
      } else if (isPhysicallyOccupied || slot.status === 'occupied') {
        resolvedStatus = 'occupied';
      }
      return {
        ...slot,
        status: resolvedStatus,
        subscriptionType: slotPackageMap[slot.slotNumber] || null,
        subscriptionDetail: slotSubscriptionMap[slot.slotNumber] || null
      };
    });

    res.status(200).json({ success: true, data: enrichedSlots });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get Live Map Data (Unified slots across all floors with real-time status)
exports.getLiveMapData = async (req, res) => {
  try {
    const BookingHold = require('../models/BookingHold');
    const SlotMaintenanceLog = require('../models/SlotMaintenanceLog');

    const slots = await Slot.find()
      .select('-aiObservation.fullSnapshot -aiObservation.evidenceSnapshot')
      .populate('zoneID', 'zoneName zoneType')
      .populate('floorID', 'name floorNumber')
      .populate('reservedFor', '_id')
      .populate('reservedByEntitlementId', 'ownerId status expireAt')
      .lean();

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
      startTime: { $lte: now },
      $or: [{ endTime: { $gte: now } }, { endTime: null }]
    }).select('slotID').lean();

    // Hash maps for quick lookup
    const slotKey = (floorId, slotCode) => `${String(floorId || '')}:${String(slotCode || '').toUpperCase()}`;
    const occupiedSlots = new Set(activeSessions.map(s => slotKey(s.floorId, s.parkingSlot)));
    const bookedSlots = new Set(upcomingBookings.map(b => slotKey(b.floorId, b.parkingSlot)));
    const heldSlots = new Set(activeHolds.map(h => slotKey(h.floorId, h.slotCode)));
    const maintenanceSet = new Set(maintenanceLogs.map(m => String(m.slotID || '')));
    const subscriptionSlots = new Set(
      slots
        .filter((slot) => {
          if (slot.reservedFor && slot.reservedFor._id) return true;
          if (slot.reservedByEntitlementId && slot.reservedByEntitlementId.ownerId) {
             const ent = slot.reservedByEntitlementId;
             if (['active', 'transfer_locked'].includes(ent.status) && new Date(ent.expireAt) > now) {
               return true;
             }
          }
          return false;
        })
        .map((slot) => String(slot._id))
    );

    const mapData = slots.map(slot => {
      let status = 'available';
      const currentSlotKey = slotKey(slot.floorID?._id || slot.floorID, slot.slotNumber);
      const isPhysicallyOccupied = Boolean(slot.aiObservation?.occupied);

      if (slot.status === 'maintenance' || maintenanceSet.has(String(slot._id))) {
        status = 'maintenance';
      } else if (occupiedSlots.has(currentSlotKey) || slot.status === 'occupied' || isPhysicallyOccupied) {
        status = 'occupied';
      } else if (bookedSlots.has(currentSlotKey) || heldSlots.has(currentSlotKey) || subscriptionSlots.has(String(slot._id))) {
        status = 'reserved';
      }

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
        detectedPlate: slot.aiObservation?.detectedPlate || null,
        isViolation: Boolean(slot.aiObservation?.isViolation),
        violationType: slot.aiObservation?.violationType || null,
        price: type === 'vip' ? '30,000₫/h' : type === 'ev' ? '20,000₫/h + EV' : '10,000₫/h'
      };
    });

    res.status(200).json({ success: true, data: mapData });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
