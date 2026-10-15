const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  month: { type: String, required: true },
  total: { type: Number, default: 0, min: 0 },
  highestAwardedThreshold: { type: Number, default: 0 },
}, { timestamps: true });
schema.index({ userId: 1, month: 1 }, { unique: true });
module.exports = mongoose.model('SpendRewardMonth', schema);
