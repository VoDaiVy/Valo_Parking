const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  type: { type: String, enum: ['MODIFY_PRICING', 'CREATE_TICKET_PACKAGE', 'UPDATE_TICKET_PACKAGE', 'UPDATE_USER_STATUS', 'APPROVE_VEHICLE', 'CREATE_POLICY_DRAFT', 'ARCHIVE_POLICY', 'CHANGE_USER_ROLE'], required: true },
  payload: { type: mongoose.Schema.Types.Mixed, required: true },
  current: mongoose.Schema.Types.Mixed,
  evidence: { type: [mongoose.Schema.Types.Mixed], default: [] },
  reason: String,
  targetId: mongoose.Schema.Types.ObjectId,
  notificationId: { type: mongoose.Schema.Types.ObjectId, ref: 'AINotification' },
  adminUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  status: { type: String, enum: ['PENDING', 'EXECUTING', 'EXECUTED', 'REJECTED'], default: 'PENDING' },
  expiresAt: { type: Date, required: true },
  executedAt: Date,
  executionResult: mongoose.Schema.Types.Mixed,
  rejectedAt: Date,
  rejectedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });
schema.index({ adminUserId: 1, createdAt: -1 });
module.exports = mongoose.model('AIDraft', schema);
