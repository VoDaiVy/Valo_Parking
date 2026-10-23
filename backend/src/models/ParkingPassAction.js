const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  passId: { type: mongoose.Schema.Types.ObjectId, ref: 'ParkingPass', required: true },
  sessionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Session' },
  actorId: { type: String, required: true },
  action: { type: String, enum: ['CHECK_IN', 'CHECK_OUT', 'REISSUE'], required: true },
  idempotencyKey: { type: String, required: true },
  requestHash: { type: String, required: true },
  status: { type: String, enum: ['pending', 'payment_pending', 'completed', 'failed'], default: 'pending' },
  evidenceImageUrl: String,
  reason: String,
  result: mongoose.Schema.Types.Mixed,
}, { timestamps: true });
schema.index({ actorId: 1, idempotencyKey: 1 }, { unique: true });
module.exports = mongoose.model('ParkingPassAction', schema);
