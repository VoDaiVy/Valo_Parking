const mongoose = require('mongoose');

const slotAuditLogSchema = new mongoose.Schema(
  {
    slotId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Slot',
      required: true,
      index: true,
    },
    slotCode: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    floorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ParkingFloor',
      required: true,
      index: true,
    },
    changeType: {
      type: String,
      enum: [
        'VIOLATION_DETECTED',
        'VIOLATION_RESOLVED',
        'OCCUPANCY_CHANGED',
        'SLOT_REASSIGNED',
        'WARNING_ISSUED',
      ],
      required: true,
      index: true,
    },
    violationType: {
      type: String,
      default: null,
      index: true,
    },
    detectedPlate: {
      type: String,
      default: null,
      trim: true,
    },
    expectedSlot: {
      type: String,
      default: null,
      trim: true,
    },
    expectedPlate: {
      type: String,
      default: null,
      trim: true,
    },
    evidenceSnapshot: {
      type: String,
      default: null,
    },
    fullSnapshot: {
      type: String,
      default: null,
    },
    violationMessage: {
      type: String,
      default: null,
    },
    status: {
      type: String,
      enum: ['PENDING', 'RESOLVED', 'DISMISSED'],
      default: 'PENDING',
      index: true,
    },
    resolvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    resolverName: {
      type: String,
      default: null,
    },
    resolvedAt: {
      type: Date,
      default: null,
    },
    resolutionAction: {
      type: String,
      default: null,
    },
    resolutionNote: {
      type: String,
      default: null,
    },
    sessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Session',
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

slotAuditLogSchema.index({ floorId: 1, createdAt: -1 });
slotAuditLogSchema.index({ slotCode: 1, createdAt: -1 });
slotAuditLogSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('SlotAuditLog', slotAuditLogSchema);
