const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  sessionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Session', required: true, unique: true },
  passId: { type: mongoose.Schema.Types.ObjectId, ref: 'ParkingPass', required: true },
  passVersion: { type: Number, required: true },
  phone: { type: String, required: true, select: false },
  rememberRecipient: { type: Boolean, default: false },
  tokenHash: { type: String, required: true, unique: true, select: false },
  principal: { type: String, required: true },
  authExpiresAt: { type: Date, required: true },
  state: { type: String, enum: ['prepared', 'needs_link', 'queued', 'cancelled'], default: 'prepared' },
  lastClaimAt: Date,
  lastRetryAt: Date,
  retryCount: { type: Number, default: 0 },
  expiresAt: { type: Date, default: () => new Date(Date.now() + 30 * 86400000) },
}, { timestamps: true });
schema.index({ state: 1, createdAt: 1 });
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
module.exports = mongoose.model('TelegramReceipt', schema);
