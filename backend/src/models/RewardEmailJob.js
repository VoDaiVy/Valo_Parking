const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  voucherId: { type: mongoose.Schema.Types.ObjectId, ref: 'UserVoucher', required: true, unique: true },
  status: { type: String, enum: ['pending', 'sending', 'sent', 'cancelled'], default: 'pending' },
  attempts: { type: Number, default: 0 },
  nextAttemptAt: { type: Date, default: Date.now },
  lockedUntil: { type: Date, default: null },
  lockToken: String,
  sentAt: Date,
  lastError: { type: String, default: '' },
}, { timestamps: true });
schema.index({ status: 1, nextAttemptAt: 1, lockedUntil: 1 });
module.exports = mongoose.model('RewardEmailJob', schema);
