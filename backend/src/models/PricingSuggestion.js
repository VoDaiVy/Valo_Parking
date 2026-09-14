const mongoose = require('mongoose');

const pricingSuggestionSchema = new mongoose.Schema(
  {
    priceType: { type: String, enum: ['hourly', 'package'], required: true },
    packageId: { type: mongoose.Schema.Types.ObjectId, ref: 'TicketPackage', default: null },
    basePrice: { type: Number, required: true, min: 0 },
    suggestedPrice: { type: Number, required: true, min: 0 },
    multiplier: { type: Number, required: true, min: 0.5, max: 3.0 },
    busynessScore: { type: Number, required: true, min: 0, max: 100 },
    level: { type: String, enum: ['low', 'moderate', 'high', 'peak'], required: true },
    appliedRuleId: { type: mongoose.Schema.Types.ObjectId, ref: 'PricingRule', default: null },
    reason: { type: String, trim: true, default: '' },
    validFrom: { type: Date, default: Date.now },
    validUntil: { type: Date, required: true },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'expired'],
      default: 'pending',
      index: true,
    },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    reviewedAt: { type: Date, default: null },
    rejectedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

pricingSuggestionSchema.index({ priceType: 1, packageId: 1, status: 1, createdAt: -1 });
pricingSuggestionSchema.index({ status: 1, validUntil: 1 });

module.exports = mongoose.model('PricingSuggestion', pricingSuggestionSchema);
