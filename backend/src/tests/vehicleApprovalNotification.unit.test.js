const test = require('node:test');
const assert = require('node:assert/strict');
const AINotification = require('../models/AINotification');
const {
  notifyVehiclePendingSafely,
  resolveVehiclePendingSafely,
  clearVehiclePendingSafely,
} = require('../services/aiCopilot/notificationEvents');

test('Gemini review creates a pending-vehicle alert with a useful reason', async (t) => {
  t.mock.method(AINotification, 'updateOne', async (_filter, update) => {
    const event = update.$setOnInsert;
    assert.equal(event.notificationType, 'VEHICLE_PENDING_VERIFICATION');
    assert.equal(event.title, 'Gemini chưa duyệt được xe');
    assert.match(event.summary, /biển số/);
    assert.match(event.summary, /màu sơn/);
    assert.equal(event.evidence.owner, 'owner-id');
    return { upsertedCount: 1, upsertedId: 'notice-id' };
  });
  const result = await notifyVehiclePendingSafely({
    _id: 'vehicle-id', owner: 'owner-id', licensePlate: '51H12345', status: 'pending',
    registrationVerification: { decision: 'review', reason: 'mismatch:licensePlate,colorText' },
  });
  assert.equal(result, true);
});

test('approval resolves and deletion clears the pending alert', async (t) => {
  const updates = [];
  t.mock.method(AINotification, 'updateMany', async (filter, update) => {
    assert.equal(filter.entityId, 'vehicle-id');
    updates.push(update.$set.status);
    return { modifiedCount: 1 };
  });
  await resolveVehiclePendingSafely({ _id: 'vehicle-id' }, 'admin-id');
  await clearVehiclePendingSafely({ _id: 'vehicle-id' });
  assert.deepEqual(updates, ['RESOLVED', 'CLEARED']);
});
