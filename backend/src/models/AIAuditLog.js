const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  action: { type: String, required: true },
  subjectId: mongoose.Schema.Types.ObjectId,
  toolName: String,
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  errorCode: String,
}, { timestamps: true });
schema.index({ actorId: 1, createdAt: -1 });
module.exports = mongoose.model('AIAuditLog', schema);
