const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  grantId: { type: mongoose.Schema.Types.ObjectId, ref: 'MembershipServiceGrant', required: true },
  entitlementId: { type: mongoose.Schema.Types.ObjectId, ref: 'MembershipSlotEntitlement', required: true },
  requesterId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  vehicleId: { type: mongoose.Schema.Types.ObjectId, ref: 'Vehicle', required: true },
  sessionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Session' },
  serviceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Service' },
  accountingMode: { type: String, enum: ['legacy_reserved', 'consumed_on_start', 'customer_reserved'], default: 'legacy_reserved' },
  startedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  startedAt: Date,
  completedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  completedAt: Date,
  usageReversedAt: Date,
  usageReversedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  licensePlate: { type: String, required: true },
  serviceName: { type: String, required: true },
  expiresAt: { type: Date, required: true },
  slotCode: { type: String, required: true },
  status: { type: String, enum: ['pending', 'in_progress', 'done', 'cancelled'], default: 'pending' },
  idempotencyKey: { type: String, required: true },
  requestHash: { type: String, required: true },
  history: [{
    _id: false,
    status: { type: String, required: true },
    actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    at: { type: Date, required: true },
    reason: { type: String, default: '' },
  }],
}, { timestamps: true });
schema.index({ requesterId: 1, idempotencyKey: 1 }, { unique: true });
schema.index({ entitlementId: 1, status: 1 });
schema.index({ status: 1, createdAt: -1 });
schema.index({ status: 1, expiresAt: 1 });
schema.index({ sessionId: 1, serviceId: 1 }, {
  unique: true,
  partialFilterExpression: { accountingMode: 'consumed_on_start', status: 'in_progress' },
});
module.exports = mongoose.model('MembershipServiceRequest', schema);
