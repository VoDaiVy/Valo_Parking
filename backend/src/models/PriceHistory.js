const mongoose = require('mongoose');

const priceHistorySchema = new mongoose.Schema(
  {
    priceType: { type: String, enum: ['hourly', 'package'], required: true },
    packageId: { type: mongoose.Schema.Types.ObjectId, ref: 'TicketPackage', default: null },
    targetDate: { type: String, default: null },
    targetHour: { type: Number, default: null, min: 0, max: 23 },
    floorId: { type: mongoose.Schema.Types.ObjectId, ref: 'ParkingFloor', default: null },
    oldPrice: { type: Number, required: true, min: 0 },
    newPrice: { type: Number, required: true, min: 0 },
    busynessScore: { type: Number, required: true, min: 0, max: 100 },
    level: { type: String, enum: ['low', 'moderate', 'high', 'peak'], required: true },
    appliedRuleId: { type: mongoose.Schema.Types.ObjectId, ref: 'PricingRule', default: null },
    adjustmentType: {
      type: String,
      enum: ['manual', 'auto', 'approved_suggestion'],
      required: true,
    },
    performedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    suggestionId: { type: mongoose.Schema.Types.ObjectId, ref: 'PricingSuggestion', default: null },
  },
  { timestamps: true }
);

priceHistorySchema.index({ createdAt: -1, priceType: 1, adjustmentType: 1 });

module.exports = mongoose.model('PriceHistory', priceHistorySchema);
