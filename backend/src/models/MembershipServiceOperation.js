const mongoose = require('mongoose');

// One receipt per batch, including batches whose service sets do not overlap.
const schema = new mongoose.Schema({
  sessionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Session', required: true },
  idempotencyKey: { type: String, required: true },
  requestHash: { type: String, required: true },
  actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  requestIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'MembershipServiceRequest' }],
}, { timestamps: true });
schema.index({ sessionId: 1, idempotencyKey: 1 }, { unique: true });
module.exports = mongoose.model('MembershipServiceOperation', schema);
