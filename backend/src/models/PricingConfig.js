const mongoose = require('mongoose');

const timeBlockSchema = new mongoose.Schema({
  startHour: { type: Number, required: true }, // 0 to 23
  endHour: { type: Number, required: true }, // 0 to 24 (hoặc nhỏ hơn startHour nếu vắt qua ngày)
  price: { type: Number, required: true }
}, { _id: false });

const twelveHourBlockSchema = new mongoose.Schema({
  isActive: { type: Boolean, default: false },
  startHour: { type: Number, required: true, min: 0, max: 23 },
  price: { type: Number, required: true, min: 0 },
}, { _id: false });

const pricePolicySchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 120 },
  scope: {
    type: String,
    enum: ['weekday', 'month', 'date_range'],
    required: true,
  },
  daysOfWeek: [{ type: Number, min: 0, max: 6 }],
  months: [{ type: Number, min: 1, max: 12 }],
  startDate: { type: String, default: null },
  endDate: { type: String, default: null },
  adjustmentPercent: { type: Number, required: true, min: -100, max: 500 },
  priority: { type: Number, default: 0, min: 0, max: 10000 },
  isActive: { type: Boolean, default: true },
}, { _id: true });

const pricingConfigSchema = new mongoose.Schema(
  {
    timeBlocks: {
      type: [timeBlockSchema],
      required: true,
      default: [
        { startHour: 7, endHour: 12, price: 10000 },
        { startHour: 12, endHour: 17, price: 10000 },
        { startHour: 17, endHour: 22, price: 20000 },
        { startHour: 22, endHour: 7, price: 25000 }
      ]
    },
    cap12h: {
      type: Number,
      required: true,
      default: 100000,
    },
    cap24h: {
      type: Number,
      required: true,
      default: 180000,
    },
    dayNightPricing: {
      day: {
        type: twelveHourBlockSchema,
        default: () => ({ isActive: false, startHour: 6, price: 50000 }),
      },
      night: {
        type: twelveHourBlockSchema,
        default: () => ({ isActive: false, startHour: 18, price: 70000 }),
      },
    },
    pricePolicies: {
      type: [pricePolicySchema],
      default: [],
    },
    isActive: {
      type: Boolean,
      default: true,
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model('PricingConfig', pricingConfigSchema);
