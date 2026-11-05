const test = require('node:test');
const assert = require('node:assert/strict');
const service = require('../services/membershipDetailsService');
const controller = require('../controllers/membershipDetailsController');

// Same field structure and statuses as the three audited failed PayOS attempts.
const entitlementId = '507f1f77bcf86cd7950fc99d';
const ownerId = '507f1f77bcf86cd799439011';
const history = {
  items: ['ba7d0299', 'ba7cff5b', 'ba7cff4f'].map((suffix, index) => ({
    _id: `507f1f77bcf86cd7${suffix}`, scope: 'entitlement', status: 'failed',
    paymentMethod: 'payos', amount: 50000,
    createdAt: new Date(`2026-10-22T10:${16 - index}:16.616Z`),
    oldExpireAt: new Date('2026-10-22T13:42:46.553Z'),
    newExpireAt: new Date('2026-11-22T13:42:46.553Z'),
  })),
  pagination: { page: 1, limit: 10, total: 3, totalPages: 1 },
};
const req = (query = {}) => ({ user: { _id: ownerId }, params: { entitlementId }, query });
const invoke = async (handler, request) => {
  let result;
  await handler(request, { json: (value) => { result = JSON.parse(JSON.stringify(value)); } }, (error) => { throw error; });
  return result;
};

test('renewals controller preserves all three failed attempts, exact owner/entitlement and numeric pagination', async (t) => {
  t.mock.method(service, 'history', async (user, id, kind, paging) => {
    assert.equal(user, ownerId); assert.equal(id, entitlementId); assert.equal(kind, 'entitlement');
    assert.deepEqual(paging, { page: 1, limit: 10 });
    return history;
  });
  const response = await invoke(controller.history, req({ page: '1', limit: '10' }));
  assert.equal(response.success, true);
  assert.deepEqual(response.data, JSON.parse(JSON.stringify(history)));
  assert.equal(response.data.items.filter((row) => row.status === 'failed').length, 3);
});

test('details controller preserves denial code/message and never turns canRenew false into eligibility', async (t) => {
  const detail = { entitlementId, kind: 'entitlement', floorName: '', renewal: {
    canRenew: false, reasonCode: 'MEMBERSHIP_FLOOR_NOT_FOUND',
    message: 'Renewal is unavailable: the referenced parking floor no longer exists. Please contact parking support.',
  } };
  t.mock.method(service, 'getDetail', async (user, id, kind) => {
    assert.equal(user, ownerId); assert.equal(id, entitlementId); assert.equal(kind, 'entitlement'); return detail;
  });
  assert.deepEqual((await invoke(controller.detail, req())).data, detail);
});
