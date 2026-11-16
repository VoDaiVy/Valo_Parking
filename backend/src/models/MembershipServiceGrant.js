const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  entitlementId: { type: mongoose.Schema.Types.ObjectId, ref: 'MembershipSlotEntitlement', required: true },
  sourceKey: { type: String, required: true },
  serviceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Service', required: true },
  serviceName: { type: String, required: true },
  validFrom: { type: Date, required: true },
  expireAt: { type: Date, required: true },
  total: { type: Number, min: 1, required: true },
  reserved: { type: Number, min: 0, default: 0 },
  used: { type: Number, min: 0, default: 0 },
}, { timestamps: true });
schema.index({ entitlementId: 1, sourceKey: 1, serviceId: 1 }, { unique: true });
schema.index({ entitlementId: 1, expireAt: 1 });
module.exports = mongoose.model('MembershipServiceGrant', schema);
