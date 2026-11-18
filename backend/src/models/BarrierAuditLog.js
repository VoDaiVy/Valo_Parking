const mongoose = require('mongoose');

const barrierAuditLogSchema = new mongoose.Schema(
  {
    gate: {
      type: String,
      required: true,
      trim: true,
    },
    action: {
      type: String,
      enum: ['open', 'hold', 'close'],
      default: 'open',
    },
    reason: {
      type: String,
      required: true,
      trim: true,
    },
    notes: {
      type: String,
      default: '',
      trim: true,
    },
    licensePlate: {
      type: String,
      default: '',
      trim: true,
    },
    staffId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    staffName: {
      type: String,
      default: 'Staff',
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

barrierAuditLogSchema.index({ gate: 1, createdAt: -1 });
barrierAuditLogSchema.index({ staffId: 1, createdAt: -1 });

module.exports = mongoose.model('BarrierAuditLog', barrierAuditLogSchema);

