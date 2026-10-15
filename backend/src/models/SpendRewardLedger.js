const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  sourceKey: { type: String, required: true, unique: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  month: { type: String, required: true },
  amount: { type: Number, required: true, min: 0 },
  occurredAt: { type: Date, required: true },
  sourceUpdatedAt: Date,
}, { timestamps: true });
schema.index({ userId: 1, month: 1 });
module.exports = mongoose.model('SpendRewardLedger', schema);
