const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  telegramUserId: { type: String, required: true },
  chatId: { type: String, required: true },
  username: String,
  phone: { type: String, select: false },
  notificationsEnabled: { type: Boolean, default: true },
  linkedAt: { type: Date, default: Date.now },
  revokedAt: { type: Date, default: null },
  blockedAt: { type: Date, default: null },
}, { timestamps: true });
schema.index({ telegramUserId: 1 }, { unique: true, partialFilterExpression: { revokedAt: null } });
module.exports = mongoose.model('TelegramLink', schema);
