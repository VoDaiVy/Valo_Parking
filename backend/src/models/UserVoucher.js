const mongoose = require('mongoose');

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

const userVoucherSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    templateId: { type: mongoose.Schema.Types.ObjectId, ref: 'VoucherTemplate', required: function () { return !['spending', 'welcome'].includes(this.source); } },
    source: { type: String, enum: ['loyalty', 'spending', 'manual', 'welcome'], default: 'loyalty' },
    rewardKey: { type: String },
    rewardMonth: String,
    rewardThreshold: Number,
    benefitSnapshot: {
      name: { type: String, required: true },
      description: { type: String, default: '' },
      type: { type: String, enum: ['PERCENT_DISCOUNT', 'FREE_SERVICE', 'FIXED_DISCOUNT'], required: true },
      pointCost: { type: Number, required: true, min: 0 },
      discountAmount: { type: Number, min: 0, default: 0 },
      minimumAmount: { type: Number, min: 0, default: 0 },
      discountPercent: { type: Number, default: null, min: 1, max: 100, validate: (value) => value == null || Number.isInteger(value) },
      serviceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Service', default: null },
    },
    status: {
      type: String,
      enum: ['available', 'used', 'expired', 'revoked'],
      default: 'available',
    },
    redeemedAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true },
    expiryChangeCount: { type: Number, default: 0, min: 0, max: 20 },
    expiryHistory: [{
      from: { type: Date, required: true },
      to: { type: Date, required: true },
      changedAt: { type: Date, required: true },
      changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    }],
    usedAt: { type: Date, default: null },
    bookingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking', default: null },
  },
  { timestamps: true }
);

userVoucherSchema.pre('validate', function setExpiry(next) {
  if (this.isNew && !this.expiresAt) {
    this.expiresAt = new Date(new Date(this.redeemedAt).getTime() + THIRTY_DAYS_MS);
  }
  next();
});

userVoucherSchema.index({ userId: 1, status: 1 });
userVoucherSchema.index({ rewardKey: 1 }, { unique: true, partialFilterExpression: { rewardKey: { $type: 'string' } } });
userVoucherSchema.index({ bookingId: 1 }, { sparse: true });
userVoucherSchema.index({ source: 1, rewardMonth: 1, rewardThreshold: 1 });

userVoucherSchema.statics.THIRTY_DAYS_MS = THIRTY_DAYS_MS;

module.exports = mongoose.model('UserVoucher', userVoucherSchema);
