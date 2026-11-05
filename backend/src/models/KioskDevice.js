const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  gate: { type: String, enum: ['ENTRY_1', 'EXIT_1'], required: true },
  credentialHash: { type: String, required: true, unique: true, select: false },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  enabled: { type: Boolean, default: true },
  expiresAt: { type: Date, required: true },
}, { timestamps: true });
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('KioskDevice', schema);
