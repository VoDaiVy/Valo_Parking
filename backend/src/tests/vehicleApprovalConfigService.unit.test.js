const test = require('node:test');
const assert = require('node:assert/strict');
const VehicleApprovalConfig = require('../models/VehicleApprovalConfig');
const {
  getVehicleApprovalConfig,
  setVehicleApprovalEnabled,
} = require('../services/vehicleApprovalConfigService');

test('AI approval defaults to off until an admin saves a setting', async () => {
  const original = VehicleApprovalConfig.findById;
  VehicleApprovalConfig.findById = (id) => {
    assert.equal(id, 'global');
    return { lean: async () => null };
  };
  try {
    assert.deepEqual(await getVehicleApprovalConfig(), {
      enabled: false, configured: Boolean(process.env.GEMINI_API_KEY), updatedAt: null,
    });
  } finally {
    VehicleApprovalConfig.findById = original;
  }
});

test('admin setting is persisted as an explicit boolean', async () => {
  const original = VehicleApprovalConfig.findOneAndUpdate;
  VehicleApprovalConfig.findOneAndUpdate = async (filter, update, options) => {
    assert.deepEqual(filter, { _id: 'global' });
    assert.deepEqual(update, { $set: { enabled: true, updatedBy: 'admin-id' } });
    assert.equal(options.upsert, true);
    return { enabled: true, updatedAt: new Date('2026-01-01') };
  };
  try {
    const saved = await setVehicleApprovalEnabled(true, 'admin-id');
    assert.equal(saved.enabled, true);
    assert.equal(saved.configured, Boolean(process.env.GEMINI_API_KEY));
  } finally {
    VehicleApprovalConfig.findOneAndUpdate = original;
  }
});
