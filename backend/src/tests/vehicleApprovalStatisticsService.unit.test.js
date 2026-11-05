const test = require('node:test');
const assert = require('node:assert/strict');
const Vehicle = require('../models/Vehicle');
const { getVehicleApprovalStatistics } = require('../services/vehicleApprovalStatisticsService');
const { execute, getToolsForRole } = require('../services/aiCopilot/toolRegistry');

test('counts approvals in the current Vietnam calendar day by source', async (t) => {
  t.mock.method(Vehicle, 'aggregate', async (pipeline) => {
    assert.equal(pipeline[0].$match.status, 'approved');
    assert.equal(pipeline[0].$match.approvedAt.$gte.toISOString(), '2026-09-22T17:00:00.000Z');
    assert.equal(pipeline[0].$match.approvedAt.$lt.toISOString(), '2026-09-23T17:00:00.000Z');
    return [{ _id: 'ai', count: 3 }, { _id: 'admin', count: 2 }];
  });
  const result = await getVehicleApprovalStatistics({}, new Date('2026-09-22T18:00:00.000Z'));
  assert.equal(result.totalApproved, 5);
  assert.equal(result.aiApproved, 3);
  assert.equal(result.adminApproved, 2);
});

test('uses the requested inclusive date range', async (t) => {
  t.mock.method(Vehicle, 'aggregate', async (pipeline) => {
    assert.equal(pipeline[0].$match.approvedAt.$gte.toISOString(), '2026-09-20T17:00:00.000Z');
    assert.equal(pipeline[0].$match.approvedAt.$lt.toISOString(), '2026-09-22T17:00:00.000Z');
    return [];
  });
  const result = await getVehicleApprovalStatistics({
    startDate: '2026-09-20T17:00:00.000Z',
    endDate: '2026-09-22T16:59:59.999Z',
  });
  assert.equal(result.totalApproved, 0);
});

test('approval statistics are available to admin chat but not staff chat', async (t) => {
  assert.ok(getToolsForRole('admin').some((tool) => tool.name === 'get_vehicle_approval_statistics'));
  assert.ok(!getToolsForRole('staff').some((tool) => tool.name === 'get_vehicle_approval_statistics'));
  t.mock.method(Vehicle, 'aggregate', async () => [{ _id: 'ai', count: 1 }]);
  const output = await execute('get_vehicle_approval_statistics', {}, 'admin');
  assert.equal(output.data.totalApproved, 1);
  await assert.rejects(execute('get_vehicle_approval_statistics', {}, 'staff'));
});
