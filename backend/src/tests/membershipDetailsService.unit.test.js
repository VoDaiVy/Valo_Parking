const test = require('node:test');
const assert = require('node:assert/strict');
const { createMembershipDetailsService } = require('../services/membershipDetailsService');

const userId = '507f1f77bcf86cd799439011';
const id = '507f1f77bcf86cd799439012';
const sourceSubscriptionId = '507f1f77bcf86cd799439013';
const floorId = '507f1f77bcf86cd799439014';
const now = new Date('2030-01-01T00:00:00Z');
const entity = () => ({ _id: id, ownerId: userId, sourceSubscriptionId, floorId, slotCode: 'A01', status: 'active', validFrom: now, expireAt: new Date('2030-01-03T00:00:00Z'), packageId: { _id: id, name: 'Monthly', type: 'monthly', renewalWindowDays: 5 }, transferCount: 0 });
const query = (value) => ({ populate() { return this; }, select() { return this; }, lean: async () => value, then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); } });
function setup(overrides = {}) {
  const calls = {};
  const service = createMembershipDetailsService({
    renewalEnabled: true,
    validateTransferSpace: overrides.validateTransferSpace || (async () => {}),
    Entitlement: { findOne: (filter) => { calls.owner = filter; return query(overrides.entity === null ? null : (overrides.entity || entity())); }, find: () => query(overrides.migrated || []) },
    Subscription: { findOne: (filter) => { calls.subscriptionOwner = filter; return query(overrides.subscription || null); } },
    Vehicle: { find: (filter) => { calls.vehicles = filter; return query([{ _id: id, licensePlate: '43A12345' }]); } },
    Renewal: { findOne: () => query(overrides.pending || null), aggregate: async (pipeline) => { calls.pipeline = pipeline; return [{ items: [], count: [{ total: 12 }] }]; } },
    SubscriptionRenewal: { findOne: () => query(null), collection: { name: 'subscriptionrenewals' } },
    quoteEntitlement: async (...args) => { calls.quote = args; if (overrides.quoteError) throw overrides.quoteError; },
    quoteSubscription: async () => {},
  });
  return { service, calls };
}

test('individual expiry, backend renewal window, pending and locked eligibility remain separate', async () => {
  const { service } = setup();
  const detail = await service.presentEntitlement(userId, entity(), now);
  assert.equal(detail.daysRemaining, 2);
  assert.equal(detail.expiringSoon, true);
  assert.equal(detail.renewal.renewalWindowDays, 5);
  assert.equal(detail.renewal.canRenew, true);
  const later = { ...entity(), expireAt: new Date('2030-01-07T00:00:00Z') };
  assert.equal((await service.renewalState(userId, later, 'entitlement', now)).reasonCode, 'RENEWAL_WINDOW_NOT_OPEN');
  assert.equal((await service.renewalState(userId, { ...entity(), status: 'transfer_locked' }, 'entitlement', now)).canRenew, false);
  assert.equal((await setup({ pending: { _id: id } }).service.renewalState(userId, entity(), 'entitlement', now)).reasonCode, 'RENEWAL_PENDING');
  const expired = await service.presentEntitlement(userId, { ...entity(), expireAt: new Date('2029-12-31') }, now);
  assert.equal(expired.status, 'expired');
  assert.equal(expired.renewal.canRenew, false);
});

test('detail scopes owner, returns only current-owner approved vehicles, allows expired details', async () => {
  const { service, calls } = setup({ entity: { ...entity(), expireAt: new Date('2020-01-01'), status: 'expired' } });
  const result = await service.getDetail(userId, id);
  assert.deepEqual(calls.owner, { _id: id, ownerId: userId });
  assert.deepEqual(calls.vehicles, { owner: userId, status: 'approved' });
  assert.equal(result.status, 'expired');
  assert.equal(result.eligibleVehicles.length, 1);
  assert.match(result.vehicleUsageNote, /one vehicle at a time/);
  assert.equal(result.vehicleId, undefined);
});

test('a missing populated floor does not become an ownership 404; renewal exposes the physical-space denial', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now });
  const { service } = setup({
    entity: { ...entity(), floorId: null },
    quoteError: Object.assign(new Error('Renewal is unavailable: the referenced parking floor no longer exists.'), { statusCode: 409, code: 'MEMBERSHIP_FLOOR_NOT_FOUND' }),
  });
  const detail = await service.getDetail(userId, id);
  assert.equal(detail.floorName, '');
  assert.equal(detail.renewal.canRenew, false);
  assert.equal(detail.renewal.reasonCode, 'MEMBERSHIP_FLOOR_NOT_FOUND');
});

test('details and membership card presentation disable transfer with a physical-space reason', async () => {
  const { service } = setup({ validateTransferSpace: async () => {
    throw Object.assign(new Error('Transfer is unavailable: the referenced parking floor no longer exists.'), { statusCode: 409, code: 'MEMBERSHIP_FLOOR_NOT_FOUND' });
  } });
  const detail = await service.presentEntitlement(userId, entity(), now);
  assert.equal(detail.canTransfer, false);
  assert.match(detail.transferUnavailableReason, /floor no longer exists/);
});

test('transferred or inaccessible entitlement rejects detail and history before fetching vehicles or transactions', async () => {
  const { service, calls } = setup({ entity: null });
  await assert.rejects(service.getDetail(userId, id), (error) => error.statusCode === 404 && error.code === 'MEMBERSHIP_UNAVAILABLE');
  await assert.rejects(service.history(userId, id), (error) => error.statusCode === 404);
  assert.equal(calls.vehicles, undefined);
  assert.equal(calls.pipeline, undefined);
  const oldSubscription = { _id: sourceSubscriptionId, user: userId, slots: [{ floorId, slotCode: 'A01' }] };
  await assert.rejects(setup({ subscription: oldSubscription, migrated: [{ ownerId: id, floorId, slotCode: 'A01' }] }).service.getDetail(userId, sourceSubscriptionId, 'subscription'), (error) => error.statusCode === 404);
});

test('history uses both real renewal collections, payer ownership, exact legacy slot and pagination', async () => {
  const { service, calls } = setup();
  const result = await service.history(userId, id, 'entitlement', { page: 2, limit: 10 });
  const pipeline = calls.pipeline;
  assert.equal(String(pipeline[0].$match.userId), userId);
  assert.equal(String(pipeline[0].$match.entitlementId), id);
  const union = pipeline.find((stage) => stage.$unionWith).$unionWith;
  assert.equal(union.coll, 'subscriptionrenewals');
  assert.equal(String(union.pipeline[0].$match.userId), userId);
  assert.equal(union.pipeline[0].$match['entitlementSnapshot.slots'].$elemMatch.slotCode, 'A01');
  assert.deepEqual(pipeline.at(-1).$facet.items, [{ $skip: 10 }, { $limit: 10 }]);
  assert.deepEqual(result.pagination, { page: 2, limit: 10, total: 12, totalPages: 2 });
  assert.deepEqual(result.items, []);
});

test('infrastructure errors do not masquerade as renewal eligibility', async () => {
  const error = new Error('database unavailable');
  await assert.rejects(setup({ quoteError: error }).service.renewalState(userId, entity(), 'entitlement', now), /database unavailable/);
});
