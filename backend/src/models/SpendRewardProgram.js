const mongoose = require('mongoose');

const money = { type: Number, required: true, min: 1000, max: 1000000000, validate: Number.isSafeInteger };
const tierSchema = new mongoose.Schema({
  threshold: money,
  discountAmount: money,
  minimumAmount: money,
}, { _id: false });

const schema = new mongoose.Schema({
  _id: { type: String, default: 'monthly' },
  enabled: { type: Boolean, default: false },
  startsAt: { type: Date, default: null },
  revision: { type: Number, default: 0 },
  validityDays: { type: Number, default: 7, min: 1, max: 365 },
  tiers: { type: [tierSchema], default: () => [
    { threshold: 300000, discountAmount: 20000, minimumAmount: 100000 },
    { threshold: 700000, discountAmount: 50000, minimumAmount: 200000 },
    { threshold: 1500000, discountAmount: 100000, minimumAmount: 400000 },
  ] },
}, { timestamps: true });

module.exports = mongoose.model('SpendRewardProgram', schema);
