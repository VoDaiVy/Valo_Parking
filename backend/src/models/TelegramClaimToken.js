const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  tokenHash: { type: String, required: true, unique: true },
  purpose: { type: String, enum: ['link', 'guest'], required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  bookingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking' },
  sessionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Session' },
  passId: { type: mongoose.Schema.Types.ObjectId, ref: 'ParkingPass' },
  passVersion: Number,
  receiptId: { type: mongoose.Schema.Types.ObjectId, ref: 'TelegramReceipt' },
  recipientPhone: { type: String, select: false },
  rememberRecipient: { type: Boolean, default: false },
  boundTelegramUserId: String,
  boundChatId: String,
  consumedAt: { type: Date, default: null },
  revokedAt: { type: Date, default: null },
  expiresAt: { type: Date, required: true },
}, { timestamps: true });
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
schema.index({ boundTelegramUserId: 1, boundChatId: 1, consumedAt: 1 });
module.exports = mongoose.model('TelegramClaimToken', schema);
