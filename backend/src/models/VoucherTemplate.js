const mongoose = require('mongoose');

const voucherTemplateSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, default: '', trim: true },
    type: {
      type: String,
      enum: ['PERCENT_DISCOUNT', 'FREE_SERVICE'],
      required: true,
    },
    pointCost: {
      type: Number,
      required: true,
      min: 1,
      validate: { validator: Number.isInteger, message: 'pointCost must be an integer' },
    },
    discountPercent: {
      type: Number,
      required: function requireDiscountPercent() { return this.type === 'PERCENT_DISCOUNT'; },
      min: 1,
      max: 100,
      default: null,
      validate: {
        validator: (value) => value === null || Number.isInteger(value),
        message: 'discountPercent must be an integer',
      },
    },
    serviceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Service',
      default: null,
      required: function requireService() { return this.type === 'FREE_SERVICE'; },
    },
    redemptionLimit: {
      type: Number,
      default: null,
      min: 1,
      validate: {
        validator: function validateRedemptionLimit(value) {
          return value === null
            || (Number.isInteger(value) && value >= Number(this.redeemedCount || 0));
        },
        message: 'redemptionLimit must be a positive integer and cannot be lower than redeemedCount',
      },
    },
    redeemedCount: {
      type: Number,
      default: 0,
      min: 0,
      validate: { validator: Number.isInteger, message: 'redeemedCount must be an integer' },
    },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

voucherTemplateSchema.pre('validate', function validateBenefit(next) {
  if (this.type === 'PERCENT_DISCOUNT') {
    if (!Number.isInteger(this.discountPercent)) {
      this.invalidate('discountPercent', 'discountPercent is required for percentage vouchers');
    }
    this.serviceId = null;
  }
  if (this.type === 'FREE_SERVICE') {
    if (!this.serviceId) this.invalidate('serviceId', 'serviceId is required for free-service vouchers');
    this.discountPercent = null;
  }
  next();
});

module.exports = mongoose.model('VoucherTemplate', voucherTemplateSchema);
