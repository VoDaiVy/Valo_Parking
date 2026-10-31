const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const service = require('../services/membershipActivityService');
const controller = require('../controllers/membershipActivityController');
const owner = '507f1f77bcf86cd799439011';
const other = '507f1f77bcf86cd799439012';

test('every activity source is owner-scoped before joins; no wallet or success-notification duplication', () => {
  const user = new mongoose.Types.ObjectId(owner);
  const pipeline = service.buildPipeline(user, { page: 2, limit: 15, filter: 'all' });
  assert.equal(String(pipeline[0].$match.userId), owner);
  const branches = pipeline.filter((stage) => stage.$unionWith).map((stage) => stage.$unionWith);
  assert.deepEqual(branches.map((branch) => branch.coll), ['subscriptionrenewals', 'subscriptions', 'usernotifications']);
  for (const branch of branches) assert.equal(String(branch.pipeline[0].$match[branch.coll === 'subscriptions' ? 'user' : 'userId']), owner);
  const entLookup = pipeline.find((stage) => stage.$lookup?.from === 'membershipslotentitlements').$lookup;
  assert.equal(String(entLookup.pipeline[0].$match.ownerId), owner);
  const notices = branches.find((branch) => branch.coll === 'usernotifications');
  const allowed = notices.pipeline.find((stage) => stage.$match?.['notice.metadata.eventType']).$match['notice.metadata.eventType'].$in;
  assert.ok(allowed.includes('MEMBERSHIP_ENTITLEMENT_EXPIRING_SOON'));
  assert.ok(allowed.every((type) => !type.includes('RENEWAL')));
  assert.deepEqual(pipeline.at(-2), { $sort: { timestamp: -1, scope: 1, _id: -1 } });
  assert.deepEqual(pipeline.at(-1).$facet.items, [{ $skip: 15 }, { $limit: 15 }]);
  assert.ok(!JSON.stringify(pipeline).match(/\$merge|\$out|wallettransactions/));
});

test('filters are applied before pagination, with no client-side truncation', () => {
  for (const filter of ['renewals', 'payments', 'notifications']) {
    const pipeline = service.buildPipeline(new mongoose.Types.ObjectId(owner), { page: 1, limit: 15, filter });
    assert.deepEqual(pipeline.at(-3), { $match: { categories: filter } });
  }
});

test('DTO preserves paid renewal once and safely presents failed PayOS and persisted reminders', () => {
  const paid = service.present({ _id: 'one', scope: 'entitlement', kind: 'renewal', status: 'paid', paymentMethod: 'wallet', amount: 50000, oldExpireAt: 'old', newExpireAt: 'new' });
  assert.equal(paid.title, 'Renewal successful');
  assert.equal(paid.newExpireAt, 'new');
  const failed = service.present({ _id: 'two', scope: 'entitlement', kind: 'renewal', status: 'failed', paymentMethod: 'payos', newExpireAt: 'proposed', failureReason: 'SECRET raw provider stack', apiKey: 'SECRET' });
  assert.equal(failed.title, 'Renewal payment failed');
  assert.equal(failed.newExpireAt, undefined);
  assert.ok(!JSON.stringify(failed).includes('SECRET'));
  assert.match(failed.failureMessage, /does not mean your VIP PASS has expired/);
  const warning = service.present({ _id: 'three', scope: 'notification', kind: 'notification', status: 'warning', eventType: 'VIP_EXPIRING_SOON', expireAt: 'expiry' });
  assert.equal(warning.title, 'Membership expiry warning');
  assert.equal(warning.expireAt, 'expiry');
});

test('history is aggregate-only, retains separate attempts and pagination, rejects invalid inputs', async () => {
  let calls = 0;
  const history = service.createMembershipActivityService({ Renewal: { aggregate: async (pipeline) => {
    calls++;
    assert.equal(String(pipeline[0].$match.userId), owner);
    return [{ items: [{ _id: 'paid', scope: 'entitlement', kind: 'renewal', status: 'paid' }, { _id: 'failed', scope: 'entitlement', kind: 'renewal', status: 'failed' }], count: [{ total: 2 }] }];
  } } }).history;
  const result = await history(owner);
  assert.equal(result.items.length, 2);
  assert.equal(new Set(result.items.map((item) => item.id)).size, 2);
  assert.equal(result.pagination.total, 2);
  for (const args of [{ page: 0 }, { limit: 100 }, { filter: 'unknown' }]) await assert.rejects(history(owner, args), { statusCode: 400 });
  assert.equal(calls, 1);
});

test('controller takes ownership from authenticated user, ignoring caller userId', async (t) => {
  t.mock.method(service, 'history', async (user, options) => {
    assert.equal(user, owner);
    assert.deepEqual(options, { page: 2, limit: 15, filter: 'payments' });
    return { items: [], pagination: { total: 0 } };
  });
  let response;
  await controller.history({ user: { _id: owner }, query: { userId: other, page: '2', filter: 'payments' }, body: { userId: other } }, { json: (value) => { response = value; } }, (error) => { throw error; });
  assert.equal(response.success, true);
});
