const mongoose = require('mongoose');

const vehicleApprovalConfigSchema = new mongoose.Schema(
  {
    _id: { type: String, default: 'global' },
    enabled: { type: Boolean, default: false },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

module.exports = mongoose.model('VehicleApprovalConfig', vehicleApprovalConfigSchema);
