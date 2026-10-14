const mongoose = require('mongoose');

const pricingRuleSchema = new mongoose.Schema(
  {
    label: { type: String, required: true, trim: true },
    minScore: { type: Number, required: true, min: 0, max: 100 },
    maxScore: { type: Number, required: true, min: 0, max: 100 },
    multiplier: { type: Number, required: true, min: 0.5, max: 3.0 },
    priceType: {
      type: String,
      enum: ['hourly', 'package', 'all'],
      default: 'all',
    },
    packageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TicketPackage',
      default: null,
    },
    isActive: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

pricingRuleSchema.pre('validate', function validateScoreRange(next) {
  if (this.minScore >= this.maxScore) {
    this.invalidate('maxScore', 'maxScore must be greater than minScore');
  }
  if (this.priceType !== 'package' && this.packageId) {
    this.invalidate('packageId', 'packageId is only valid when priceType is package');
  }
  next();
});

pricingRuleSchema.index({ isActive: 1, priceType: 1, packageId: 1, minScore: 1, maxScore: 1 });

module.exports = mongoose.model('PricingRule', pricingRuleSchema);
