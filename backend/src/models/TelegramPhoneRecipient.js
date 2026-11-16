const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  phone: { type: String, required: true, unique: true, select: false },
  telegramUserId: { type: String, required: true },
  chatId: { type: String, required: true },
  version: { type: Number, default: 1 },
  verifiedAt: { type: Date, required: true },
  consentAt: { type: Date, required: true },
  expiresAt: { type: Date, required: true },
  revokedAt: { type: Date, default: null },
  blockedAt: { type: Date, default: null },
}, { timestamps: true });
schema.index({ telegramUserId: 1, chatId: 1 });
module.exports = mongoose.model('TelegramPhoneRecipient', schema);
