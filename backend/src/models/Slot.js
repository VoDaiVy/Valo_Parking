const mongoose = require("mongoose");

const slotSchema = new mongoose.Schema(
  {
    zoneID: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Zone",
      required: true, // As requested, every slot MUST belong to a zone
    },
    floorID: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ParkingFloor",
      required: true, // Keeping this for fast querying as discussed
    },
    slotNumber: {
      type: String,
      required: true,
      trim: true,
    },
    slotType: {
      type: String,
      default: "hourly",
    },
    gridX: {
      type: Number,
      required: true,
    },
    gridY: {
      type: Number,
      required: true,
    },
    status: {
      type: String,
      enum: ["available", "occupied", "maintenance", "booked"],
      default: "available",
    },
    maintenanceReason: {
      type: String,
      default: null,
    },
    reservedFor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    reservedBySubscriptionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Subscription",
      default: null,
    },
    reservedByEntitlementId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "MembershipSlotEntitlement",
      default: null,
    },
    reservedUntil: {
      type: Date,
      default: null,
    },
    aiObservation: {
      occupied: { type: Boolean, default: false },
      detectedPlate: { type: String, default: null },
      confidence: { type: Number, default: 0 },
      isViolation: { type: Boolean, default: false },
      violationType: { type: String, default: null },
      expectedSlot: { type: String, default: null },
      expectedPlate: { type: String, default: null },
      evidenceSnapshot: { type: String, default: null },
      fullSnapshot: { type: String, default: null },
      violationMessage: { type: String, default: null },
      sessionId: { type: mongoose.Schema.Types.ObjectId, ref: "Session", default: null },
      lastScannedAt: { type: Date, default: null },
    },
  },
  {
    timestamps: true,
  }
);

// Ensure slotNumber is unique within a zone or floor
slotSchema.index({ floorID: 1, slotNumber: 1 }, { unique: true });
slotSchema.index({ reservedBySubscriptionId: 1 });
slotSchema.index({ reservedByEntitlementId: 1 });

module.exports = mongoose.model("Slot", slotSchema);
