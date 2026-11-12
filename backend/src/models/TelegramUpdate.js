const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  updateId: { type: Number, required: true, unique: true },
  payload: { type: mongoose.Schema.Types.Mixed, required: true, select: false },
  status: { type: String, enum: ['pending', 'processing', 'done', 'failed'], default: 'pending' },
  attempts: { type: Number, default: 0 },
  nextAttemptAt: { type: Date, default: Date.now },
  leaseUntil: Date,
  leaseId: String,
  errorCode: String,
  expiresAt: { type: Date, default: () => new Date(Date.now() + 30 * 86400000) },
}, { timestamps: true });
schema.index({ status: 1, nextAttemptAt: 1, leaseUntil: 1 });
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
module.exports = mongoose.model('TelegramUpdate', schema);
