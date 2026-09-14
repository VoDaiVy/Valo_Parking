const mongoose = require('mongoose');

const bookingSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    vehicleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Vehicle',
      required: false,
    },
    licensePlate: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },
    floorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ParkingFloor',
      required: true,
    },
    parkingSlot: {
      type: String,
      required: true,
      trim: true,
    },
    scheduledStart: {
      type: Date,
      required: true,
    },
    scheduledEnd: {
      type: Date,
      required: true,
    },
    durationHours: {
      type: Number,
      required: true,
    },
    prepaidAmount: {
      type: Number,
      default: 0,
    },
    paymentBreakdownSnapshot: {
      parkingAmount: { type: Number, min: 0, default: null },
      serviceAmount: { type: Number, min: 0, default: null },
      totalAmount: { type: Number, min: 0, default: null },
      source: {
        type: String,
        enum: ['calculated', 'legacy-derived'],
        default: null,
      },
      dynamicMultiplier: { type: Number, min: 0.5, max: 3, default: 1 },
      busynessScore: { type: Number, min: 0, max: 100, default: null },
      adjustedTotal: { type: Number, min: 0, default: null },
    },
    refundPolicySnapshot: {
      source: {
        type: String,
        enum: ['published-rule', 'legacy-v1'],
        default: null,
      },
      policyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Policy', default: null },
      policyVersionId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'PolicyVersion',
        default: null,
      },
      policyVersionNumber: { type: Number, default: null },
      refundRuleVersionId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'RefundRuleVersion',
        default: null,
      },
      capturedAt: { type: Date, default: null },
      rule: { type: mongoose.Schema.Types.Mixed, default: null },
    },
    paidOverageAdjustments: [
      {
        eventKey: { type: String, required: true },
        amount: { type: Number, min: 0, required: true },
        paymentMethod: {
          type: String,
          enum: ['wallet', 'vietqr', 'qr', 'cash'],
          required: true,
        },
        sessionId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'Session',
          required: true,
        },
        paidAt: { type: Date, default: Date.now },
      },
    ],
    refundSettlements: [
      {
        eventKey: { type: String, required: true },
        eventType: {
          type: String,
          enum: ['cancellation', 'no_show', 'early_checkout', 'paused_completion'],
          required: true,
        },
        refundAmount: { type: Number, min: 0, default: 0 },
        extraAmount: { type: Number, min: 0, default: 0 },
        netWalletAmount: { type: Number, default: 0 },
        feeAmount: { type: Number, min: 0, default: 0 },
        refundableServiceAmount: { type: Number, min: 0, default: 0 },
        calculationVersion: { type: String, default: 'refund-engine-v1' },
        payoutStatus: {
          type: String,
          enum: ['credited', 'debited', 'suppressed', 'not_required'],
          default: 'not_required',
        },
        suppressionReason: { type: String, default: null },
        walletTransactionId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'WalletTransaction',
          default: null,
        },
        settledAt: { type: Date, default: Date.now },
      },
    ],
    paymentMethod: {
      type: String,
      enum: ['wallet', 'vietqr'],
      required: true,
    },
    status: {
      type: String,
      enum: ['PENDING', 'PAID', 'ACTIVE', 'PAUSED', 'EXPIRED', 'COMPLETED', 'CANCELLED'],
      default: 'PENDING',
    },
    paidAt: { type: Date, default: null, index: true },
    cancelledAt: { type: Date, default: null, index: true },
    completedAt: { type: Date, default: null, index: true },
    qrVersion: {
      type: Number,
      default: 1,
      min: 1,
    },
    modificationCount: {
      type: Number,
      default: 0,
    },
    vietqrOrderCode: {
      type: Number,
      sparse: true,
    },
    vietqrPaymentLinkId: {
      type: String,
      default: null,
    },
    slotChangesHistory: [
      {
        oldSlot: { type: String, required: true },
        newSlot: { type: String, required: true },
        reason: { type: String, required: true },
        changedAt: { type: Date, default: Date.now },
        changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      }
    ],
    contractId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Contract',
      default: null,
      index: true,
    },
  },
  { timestamps: true }
);

// Indexes
bookingSchema.index({ vehicleId: 1, scheduledStart: 1, scheduledEnd: 1 });
bookingSchema.index({ status: 1 });

const lifecycleTimestampForStatus = (status) => {
  if (status === 'PAID') return 'paidAt';
  if (status === 'CANCELLED') return 'cancelledAt';
  if (status === 'COMPLETED') return 'completedAt';
  return null;
};

bookingSchema.pre('save', function stampLifecycleTransition(next) {
  if (!this.isModified('status')) return next();
  const timestampField = lifecycleTimestampForStatus(this.status);
  if (timestampField && !this[timestampField]) this[timestampField] = new Date();
  return next();
});

bookingSchema.pre(
  ['findOneAndUpdate', 'updateOne', 'updateMany'],
  function stampLifecycleQueryTransition(next) {
    const update = this.getUpdate() || {};
    const nextStatus = update.$set?.status ?? update.status;
    const timestampField = lifecycleTimestampForStatus(nextStatus);
    if (!timestampField) return next();

    update.$set = {
      ...(update.$set || {}),
      [timestampField]: update.$set?.[timestampField] || new Date(),
      status: nextStatus,
    };
    if (Object.prototype.hasOwnProperty.call(update, 'status')) delete update.status;
    this.setUpdate(update);
    return next();
  }
);

module.exports = mongoose.model('Booking', bookingSchema);
