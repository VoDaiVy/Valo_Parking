const mongoose = require('mongoose');

const dynamicPricingConfigSchema = new mongoose.Schema(
  {
    pricingMode: {
      type: String,
      enum: ['manual', 'semi-auto', 'auto'],
      default: 'manual',
    },
    isEnabled: { type: Boolean, default: false },
    triggerThreshold: { type: Number, default: 10, min: 1, max: 50 },
    rejectionCooldownMinutes: { type: Number, default: 30, min: 1 },
    suggestionExpiryMinutes: { type: Number, default: 60, min: 1 },
    lastEvaluatedScore: { type: Number, default: null, min: 0, max: 100 },
    lastEvaluatedAt: { type: Date, default: null },
    consecutiveFailures: { type: Number, default: 0, min: 0 },
    isActive: { type: Boolean, default: true },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

dynamicPricingConfigSchema.index(
  { isActive: 1 },
  { unique: true, partialFilterExpression: { isActive: true } }
);

module.exports = mongoose.model('DynamicPricingConfig', dynamicPricingConfigSchema);
