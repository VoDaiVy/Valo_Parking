const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  dedupeKey: { type: String, required: true, unique: true },
  kind: { type: String, enum: ['booking_paid', 'guest_ticket'], required: true },
  passId: { type: mongoose.Schema.Types.ObjectId, ref: 'ParkingPass', required: true },
  bookingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking' },
  sessionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Session' },
  linkId: { type: mongoose.Schema.Types.ObjectId, ref: 'TelegramLink' },
  receiptId: { type: mongoose.Schema.Types.ObjectId, ref: 'TelegramReceipt' },
  phoneRecipientId: { type: mongoose.Schema.Types.ObjectId, ref: 'TelegramPhoneRecipient' },
  recipientVersion: Number,
  chatId: { type: String, required: true },
  telegramUserId: { type: String, required: true },
  passVersion: Number,
  status: { type: String, enum: ['pending', 'processing', 'sent', 'cancelled', 'failed', 'uncertain'], default: 'pending' },
  attempts: { type: Number, default: 0 },
  nextAttemptAt: { type: Date, default: Date.now },
  leaseUntil: Date,
  leaseId: String,
  sentAt: Date,
  messageId: Number,
  errorCode: String,
  expiresAt: { type: Date, default: () => new Date(Date.now() + 30 * 86400000) },
}, { timestamps: true });
schema.index({ status: 1, nextAttemptAt: 1, leaseUntil: 1 });
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
module.exports = mongoose.model('TelegramDelivery', schema);
