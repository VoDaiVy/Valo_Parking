const mongoose = require('mongoose');

const membershipSlotEntitlementSchema = new mongoose.Schema(
  {
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    sourceSubscriptionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Subscription',
      required: true,
      index: true,
    },
    slotId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Slot',
      required: true,
      index: true,
    },
    floorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ParkingFloor',
      required: true,
    },
    slotCode: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },
    packageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TicketPackage',
      required: true,
    },
    validFrom: {
      type: Date,
      required: true,
    },
    expireAt: {
      type: Date,
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: [
        'pending',
        'active',
        'expired',
        'cancelled',
        'transferred',
        'activation_failed',
        'transfer_locked',
      ],
      default: 'pending',
      index: true,
    },
    unitAmount: {
      type: Number,
      required: true,
      min: 0,
    },
    lineageRootId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'MembershipSlotEntitlement',
      default: null,
    },
    transferredFromEntitlementId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'MembershipSlotEntitlement',
      default: null,
    },
    transferCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    expireWarningSentAt: {
      type: Date,
      default: null,
    },
    expiryNotificationPending: { type: Boolean, default: false },
  },
  { timestamps: true }
);

membershipSlotEntitlementSchema.index(
  { sourceSubscriptionId: 1, slotId: 1 },
  { unique: true }
);
membershipSlotEntitlementSchema.index({ ownerId: 1, status: 1, expireAt: -1 });
membershipSlotEntitlementSchema.index(
  { slotId: 1, status: 1 },
  {
    unique: true,
    partialFilterExpression: {
      status: { $in: ['active', 'transfer_locked'] },
    },
  }
);

membershipSlotEntitlementSchema.pre('validate', function normalizeSlotCode(next) {
  if (this.slotCode) this.slotCode = this.slotCode.trim().toUpperCase();
  if (!this.lineageRootId && this._id) this.lineageRootId = this._id;
  next();
});

module.exports = mongoose.model(
  'MembershipSlotEntitlement',
  membershipSlotEntitlementSchema
);
