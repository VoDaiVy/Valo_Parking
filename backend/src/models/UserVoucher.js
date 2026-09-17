const mongoose = require('mongoose');

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

const userVoucherSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    templateId: { type: mongoose.Schema.Types.ObjectId, ref: 'VoucherTemplate', required: true },
    benefitSnapshot: {
      name: { type: String, required: true },
      description: { type: String, default: '' },
      type: { type: String, enum: ['PERCENT_DISCOUNT', 'FREE_SERVICE'], required: true },
      pointCost: { type: Number, required: true, min: 1 },
      discountPercent: { type: Number, default: null },
      serviceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Service', default: null },
    },
    status: {
      type: String,
      enum: ['available', 'used', 'expired'],
      default: 'available',
    },
    redeemedAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true },
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
userVoucherSchema.index({ bookingId: 1 }, { sparse: true });

userVoucherSchema.statics.THIRTY_DAYS_MS = THIRTY_DAYS_MS;

module.exports = mongoose.model('UserVoucher', userVoucherSchema);
