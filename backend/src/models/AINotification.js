const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  title: { type: String, required: true, maxlength: 200 },
  summary: { type: String, required: true, maxlength: 1000 },
  severity: { type: String, enum: ['INFO', 'NOTICE', 'WARNING', 'CRITICAL'], required: true },
  notificationType: { type: String, required: true },
  entityType: { type: String },
  entityId: { type: mongoose.Schema.Types.ObjectId },
  targetRoute: { type: String },
  evidence: { type: mongoose.Schema.Types.Mixed, required: true },
  affectedMetrics: { type: [mongoose.Schema.Types.Mixed], default: [] },
  recommendedActions: { type: [String], default: [] },
  sourceModules: { type: [String], default: [] },
  deduplicationKey: { type: String, required: true },
  status: { type: String, enum: ['OPEN', 'RESOLVED', 'CLEARED'], default: 'OPEN' },
  cleanChecks: { type: Number, default: 0 },
  resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  resolvedAt: Date,
  resolvedDraftId: { type: mongoose.Schema.Types.ObjectId, ref: 'AIDraft' },
  readBy: { type: [mongoose.Schema.Types.ObjectId], default: [] },
  dismissedBy: { type: [mongoose.Schema.Types.ObjectId], default: [] },
  detectedAt: { type: Date, default: Date.now },
  lastDetectedAt: { type: Date, default: Date.now },
  clearedAt: Date,
  targetRoles: { type: [String], default: ['admin'] },
}, { timestamps: true });

schema.index({ deduplicationKey: 1, status: 1 }, { unique: true, partialFilterExpression: { status: 'OPEN' } });
schema.index({ detectedAt: -1 });
module.exports = mongoose.model('AINotification', schema);
