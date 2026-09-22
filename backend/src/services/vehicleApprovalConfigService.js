const VehicleApprovalConfig = require('../models/VehicleApprovalConfig');

async function getVehicleApprovalConfig() {
  const config = await VehicleApprovalConfig.findById('global').lean();
  return {
    enabled: config?.enabled === true,
    configured: Boolean(process.env.GEMINI_API_KEY),
    updatedAt: config?.updatedAt || null,
  };
}

async function setVehicleApprovalEnabled(enabled, actorId) {
  const config = await VehicleApprovalConfig.findOneAndUpdate(
    { _id: 'global' },
    { $set: { enabled, updatedBy: actorId } },
    { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true },
  );
  return {
    enabled: config.enabled,
    configured: Boolean(process.env.GEMINI_API_KEY),
    updatedAt: config.updatedAt,
  };
}

module.exports = { getVehicleApprovalConfig, setVehicleApprovalEnabled };
