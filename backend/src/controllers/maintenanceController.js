const Slot = require("../models/Slot");
const SlotMaintenanceLog = require("../models/SlotMaintenanceLog");

// Start Maintenance for a specific Slot or a whole Zone
exports.startMaintenance = async (req, res) => {
  try {
    const { slotID, zoneID, reason } = req.body;
    // Assuming req.user exists from auth middleware
    const managerID = req.user ? req.user.id : null; 

    if (!reason) {
      return res.status(400).json({ success: false, message: "Reason for maintenance is required" });
    }

    if (!slotID && !zoneID) {
      return res.status(400).json({ success: false, message: "Please provide either slotID or zoneID" });
    }

    if (!managerID) {
        return res.status(401).json({ success: false, message: "Unauthorized. Manager ID is missing." });
    }

    let affectedSlots = [];

    // Case 1: Maintain a single slot
    if (slotID) {
      const slot = await Slot.findById(slotID);
      if (!slot) {
        return res.status(404).json({ success: false, message: "Slot not found" });
      }
      affectedSlots.push(slot);
    } 
    // Case 2: Maintain a whole zone
    else if (zoneID) {
      affectedSlots = await Slot.find({ zoneID: zoneID });
      if (affectedSlots.length === 0) {
        return res.status(404).json({ success: false, message: "No slots found in this zone" });
      }
    }

    // Process all affected slots
    const logPromises = [];
    for (const slot of affectedSlots) {
      // Change status to maintenance
      slot.status = "maintenance";
      slot.maintenanceReason = reason;
      await slot.save();

      // Create log
      const log = new SlotMaintenanceLog({
        slotID: slot._id,
        managerID: managerID,
        reason: reason,
        startTime: new Date()
      });
      logPromises.push(log.save());

      // Write to unified SlotAuditLog
      const SlotAuditLog = require('../models/SlotAuditLog');
      logPromises.push(
        SlotAuditLog.create({
          slotId: slot._id,
          slotCode: slot.slotNumber,
          floorId: slot.floorID,
          changeType: 'MAINTENANCE',
          status: 'PENDING',
          resolutionAction: 'UNDER_MAINTENANCE',
          resolutionNote: `Bắt đầu bảo trì: ${reason}`,
          resolvedBy: managerID,
          createdAt: new Date(),
        })
      );
    }

    await Promise.all(logPromises);

    res.status(200).json({ 
      success: true, 
      message: `Maintenance started successfully for ${affectedSlots.length} slot(s)`,
      affectedCount: affectedSlots.length
    });

  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// End Maintenance for a specific Slot or a whole Zone
exports.endMaintenance = async (req, res) => {
  try {
    const { slotID, zoneID } = req.body;

    if (!slotID && !zoneID) {
      return res.status(400).json({ success: false, message: "Please provide either slotID or zoneID" });
    }

    let affectedSlots = [];

    // Case 1: End maintenance for a single slot
    if (slotID) {
      const slot = await Slot.findById(slotID);
      if (!slot) {
        return res.status(404).json({ success: false, message: "Slot not found" });
      }
      affectedSlots.push(slot);
    } 
    // Case 2: End maintenance for a whole zone
    else if (zoneID) {
      affectedSlots = await Slot.find({ zoneID: zoneID });
      if (affectedSlots.length === 0) {
        return res.status(404).json({ success: false, message: "No slots found in this zone" });
      }
    }

    // Process all affected slots
    let endedCount = 0;
    for (const slot of affectedSlots) {
      // Only process slots that are actually in maintenance
      if (slot.status === "maintenance") {
        // Clear maintenance status
        slot.status = "available";
        slot.maintenanceReason = null;
        await slot.save();

        // Find the active log and close it
        await SlotMaintenanceLog.findOneAndUpdate(
          { slotID: slot._id, endTime: { $exists: false } },
          { endTime: new Date() },
          { sort: { startTime: -1 } }
        );

        // Write to unified SlotAuditLog
        const SlotAuditLog = require('../models/SlotAuditLog');
        await SlotAuditLog.create({
          slotId: slot._id,
          slotCode: slot.slotNumber,
          floorId: slot.floorID,
          changeType: 'MAINTENANCE',
          status: 'RESOLVED',
          resolutionAction: 'MAINTENANCE_COMPLETED',
          resolutionNote: 'Hoàn thành bảo trì, mở lại ô đỗ cho khách',
          resolvedBy: req.user?._id || null,
          createdAt: new Date(),
        });

        endedCount++;
      }
    }

    res.status(200).json({ 
      success: true, 
      message: `Maintenance ended successfully for ${endedCount} slot(s)`,
      affectedCount: endedCount
    });

  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
