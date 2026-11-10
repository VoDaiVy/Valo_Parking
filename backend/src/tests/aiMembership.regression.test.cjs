const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const Subscription = require('../models/Subscription');
const Entitlement = require('../models/MembershipSlotEntitlement');
const reads = require('../services/aiCopilot/readTools');
const registry = require('../services/aiCopilot/toolRegistry');
const { entityLinks } = require('../services/aiCopilot/entityLinks');
const id = '6aebe56ea4ec3a25a06971bf';
const otherId = '6aebe56ea4ec3a25a06971be';
const purchaser = '6aebe56ea4ec3a25a06971bd';
const owner = '6aebe56ea4ec3a25a06971bc';
// Isolated query fixtures; no database connection or writes.
const rows = [
  { _id: id, user: { _id: purchaser, username: 'original_user', email: 'original_user@example.test' }, ticketPackage: { _id: otherId, name: 'Monthly VIP', type: 'monthly', price: 150000 }, status: 'active', paymentStatus: 'paid', validFrom: new Date('2020-01-01T00:00:00Z'), expireAt: new Date('2020-02-01T00:00:00Z'), amount: 150000, slots: [{ floorId: { name: 'Floor 1' }, slotCode: 'A1' }], orderCode: 999999 },
  { _id: otherId, user: { _id: owner, email: 'current_owner@example.test' }, ticketPackage: { name: 'Yearly VIP' }, status: 'pending', paymentStatus: 'pending', amount: 0 },
];
const entitlements = [{ sourceSubscriptionId: id, ownerId: { _id: owner, username: 'current_owner', email: 'current_owner@example.test' }, slotCode: 'A1', status: 'expired' }];
const toId = value => String(value?._id || value);
function matches(row, filter) {
  return Object.entries(filter).every(([key, value]) => {
    if (key === '$and') return value.every(condition => matches(row, condition));
    if (key === '$or') return value.some(condition => matches(row, condition));
    if (value?.$in) return value.$in.map(toId).includes(toId(row[key]));
    if (value?.$gte || value?.$lt) return (!value.$gte || row[key] >= value.$gte) && (!value.$lt || row[key] < value.$lt);
    return toId(row[key]) === toId(value);
  });
}
function query(items) {
  let selected;
  const result = { sort: () => result, limit: () => result, populate: () => result, select: fields => { selected = fields.split(' '); return result; }, lean: async () => items.map(item => Object.fromEntries(Object.entries(item).filter(([key]) => !selected || selected.includes(key)))) };
  return result;
}

test('membership list/detail reads preserve purchaser, current owners, expiry, prices, spaces and exact IDs', async () => {
  const original = { find: Subscription.find, count: Subscription.countDocuments, entitlements: Entitlement.find };
  Subscription.find = filter => query(rows.filter(row => matches(row, filter)));
  Subscription.countDocuments = async filter => rows.filter(row => matches(row, filter)).length;
  Entitlement.find = filter => query(entitlements.filter(row => matches(row, filter)));
  try {
    const list = await reads.getSubscriptionMembers({ userId: owner, status: 'all' });
    assert.equal(list.total, 2); // Includes a received slot and a purchased membership.
    const detail = await registry.execute('get_subscription_detail', { subscriptionId: id }, 'admin');
    assert.equal(detail.data.user.email, 'original_user@example.test');
    assert.equal(detail.data.currentOwners[0].email, 'current_owner@example.test');
    assert.equal(detail.data.status, 'active'); assert.equal(detail.data.effectiveStatus, 'expired');
    assert.equal(detail.data.amount, 150000); assert.equal(detail.data.slots[0].slotCode, 'A1');
    assert.equal(detail.data.orderCode, undefined);
    assert.ok(detail.data.expireAt.startsWith('2020-02-01T00:00:00.000Z'));
    assert.equal(entityLinks('get_subscription_detail', detail.data)[0].url, `/admin/subscriptions?subscriptionId=${id}`);
    assert.equal((await reads.getSubscriptionMembers({ status: 'pending' })).items[0]._id, otherId);
    await assert.rejects(reads.getSubscriptionDetail({ subscriptionId: purchaser }), error => error.code === 'MEMBERSHIP_NOT_FOUND');
    await assert.rejects(reads.getSubscriptionDetail({ subscriptionId: 'invalid' }));
    await assert.rejects(registry.execute('get_subscription_detail', { subscriptionId: id }, 'customer'));
  } finally { Subscription.find = original.find; Subscription.countDocuments = original.count; Entitlement.find = original.entitlements; }
});

test('membership statistics accepts supported API ranges and preserves Vietnam/end-only boundaries', async () => {
  const statistics = require('../services/statisticsService'); const original = statistics.getAdminSubscriptionStatistics;
  const parameters = [];
  statistics.getAdminSubscriptionStatistics = async filters => { parameters.push(filters); return { summary: { sold: 0, active: 4 }, financialCoverage: 'partial' }; };
  try {
    for (const range of ['today', '7d', '30d', 'month', 'all']) {
      const result = await registry.execute('get_subscription_stats', { range, kpis: ['sold'] }, 'admin');
      assert.equal(parameters.at(-1).range, range); assert.equal(result.data.summary.sold, 0);
    }
    await registry.execute('get_subscription_stats', { startDate: '2026-01-07', endDate: '2026-01-07', kpis: ['sold'] }, 'admin');
    assert.equal(parameters.at(-1).startDate, '2026-01-06T17:00:00.000Z');
    assert.equal(parameters.at(-1).endDate, '2026-01-07T16:59:59.999Z');
    await registry.execute('get_subscription_stats', { endDate: '2026-01-07', kpis: ['sold'] }, 'admin');
    assert.deepEqual(parameters.at(-1), { endDate: '2026-01-07T16:59:59.999Z' });
    await assert.rejects(registry.execute('get_subscription_stats', { range: 'invented' }, 'admin'));
    await assert.rejects(registry.execute('get_subscription_stats', {}, 'customer'));
  } finally { statistics.getAdminSubscriptionStatistics = original; }
});

test('membership deep links verify the exact ID, include a filtered-out row and cancel stale requests', async () => {
  const module = await import(pathToFileURL(path.resolve(__dirname, '../../../frontend/src/pages/Admin/subscriptionDeepLink.js')));
  const states = []; let finish;
  const lookup = module.createSubscriptionLookup(() => new Promise(resolve => { finish = resolve; }), state => states.push(state));
  const pending = lookup.load(id); lookup.cancel();
  finish({ ok: true, data: { success: true, data: rows } }); await pending;
  assert.equal(states.at(-1).status, 'loading');
  const ready = [];
  await module.createSubscriptionLookup(async () => ({ ok: true, data: { success: true, data: rows } }), state => ready.push(state)).load(id.toUpperCase());
  assert.equal(ready.at(-1).subscription._id, id);
  const visible = module.includeLinkedSubscription([rows[1]], rows, id.toUpperCase());
  assert.deepEqual(visible.map(row => row._id), [id, otherId]);
  const missing = [];
  await module.createSubscriptionLookup(async () => ({ ok: true, data: { success: true, data: [] } }), state => missing.push(state)).load(id);
  assert.equal(missing.at(-1).status, 'missing');
});

test('membership row scrolls and highlights yellow for four seconds without invoking a modal', async t => {
  const { highlightSubscriptionCard } = await import(pathToFileURL(path.resolve(__dirname, '../../../frontend/src/pages/Admin/subscriptionDeepLink.js')));
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const classes = new Set(); let scroll;
  const row = { scrollIntoView: options => { scroll = options; }, classList: { add: (...names) => names.forEach(name => classes.add(name)), remove: (...names) => names.forEach(name => classes.delete(name)) } };
  const cancel = highlightSubscriptionCard(row, { frame: callback => { callback(); return 1; }, cancelFrame: () => {} });
  assert.equal(scroll.block, 'center'); assert.ok(classes.has('vip-membership-highlight'));
  t.mock.timers.tick(3999); assert.ok(classes.has('vip-membership-highlight'));
  t.mock.timers.tick(1); assert.ok(!classes.has('vip-membership-highlight')); cancel();
});

test('Expiring Soon and Pending Transfers match dashboard calendar days and latest-100 review scope', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-07T18:00:00Z') });
  const Transfer = require('../models/MembershipEntitlementTransfer');
  const original = { count: Subscription.countDocuments, find: Transfer.find };
  const start = Date.parse('2026-11-07T17:00:00Z'); const day = 86400000;
  const subscriptions = [
    { status: 'active', expireAt: new Date(start - 1) },
    { status: 'active', expireAt: new Date(start) }, // Earlier today still counts on the dashboard.
    { status: 'active', expireAt: new Date(start + 31 * day - 1) },
    { status: 'active', expireAt: new Date(start + 31 * day) },
    { status: 'active', paymentStatus: 'pending', expireAt: new Date(start + 20 * day) },
    { status: 'cancelled', expireAt: new Date(start + day) },
    { status: 'pending', expireAt: new Date(start + day) },
  ];
  const reviews = Array.from({ length: 110 }, (_, index) => ({ status: index < 3 || index >= 100 ? 'PENDING_ADMIN' : index === 4 ? 'PENDING_RECIPIENT' : 'AWAITING_PAYMENT' }));
  const filters = []; let reviewLimit;
  Subscription.countDocuments = async filter => { filters.push(filter); return subscriptions.filter(row => matches(row, filter)).length; };
  Transfer.find = filter => {
    assert.deepEqual(filter, {}); // Filter after the same latest-100 window as the dashboard.
    const request = { sort: sort => { assert.deepEqual(sort, { createdAt: -1 }); return request; }, limit: limit => { reviewLimit = limit; return request; }, select: () => request, lean: async () => reviews.slice(0, reviewLimit) };
    return request;
  };
  try {
    const prompt = 'Show only these four VIP membership KPIs: Total VIP, Active, Expiring Soon within 30 days, and Pending Transfers.';
    const { membershipResponseOptions, isMembershipDashboardSummary } = require('../services/aiCopilot/membershipResponses');
    const options = membershipResponseOptions(prompt);
    assert.equal(isMembershipDashboardSummary(prompt, options), true);
    const output = await registry.execute('get_subscription_stats', { kpis: options.kpis }, 'admin');
    assert.deepEqual(output.data.summary, { total: 7, expiringSoon: 3, pendingTransfers: 3, active: 5 });
    assert.equal(reviewLimit, 100);
    const expiryFilter = filters.find(filter => filter.expireAt);
    assert.equal(expiryFilter.expireAt.$gte.toISOString(), '2026-11-07T17:00:00.000Z');
    assert.equal(expiryFilter.expireAt.$lt.getTime() - start, 31 * day);
    assert.equal(expiryFilter.paymentStatus, undefined);
    assert.equal(output.data.summary.pending, undefined);
    assert.equal(output.data.summary.expiringWithin7Days, undefined);
  } finally { Subscription.countDocuments = original.count; Transfer.find = original.find; }
});

test('cancelled membership details include only vehicles linked through stored purchaser/current-owner relationships', async () => {
  const Vehicle = require('../models/Vehicle');
  const original = { find: Subscription.find, count: Subscription.countDocuments, entitlements: Entitlement.find, vehicles: Vehicle.find };
  const cancelled = { ...rows[0], status: 'cancelled' };
  const vehicles = [{ owner: purchaser, licensePlate: '43A11111' }, { owner, licensePlate: '43A1111' }, { owner: otherId, licensePlate: '43A99999' }];
  Subscription.find = filter => query([cancelled].filter(row => matches(row, filter)));
  Subscription.countDocuments = async filter => [cancelled].filter(row => matches(row, filter)).length;
  Entitlement.find = filter => query(entitlements.filter(row => matches(row, filter)));
  Vehicle.find = filter => query(vehicles.filter(row => matches(row, filter)));
  try {
    const detail = await registry.execute('get_subscription_detail', { subscriptionId: id, includeVehicles: true }, 'admin');
    assert.equal(detail.data.status, 'cancelled');
    assert.deepEqual(detail.data.linkedVehicles.map(vehicle => vehicle.licensePlate), ['43A11111', '43A1111']);
    assert.deepEqual(detail.data.linkedVehicles.map(vehicle => vehicle.ownerId), [purchaser, owner]);
    const without = await reads.getSubscriptionDetail({ subscriptionId: id });
    assert.equal(without.linkedVehicles, undefined);
    Vehicle.find = () => query([]);
    assert.deepEqual((await reads.getSubscriptionDetail({ subscriptionId: id, includeVehicles: true })).linkedVehicles, []);
  } finally { Subscription.find = original.find; Subscription.countDocuments = original.count; Entitlement.find = original.entitlements; Vehicle.find = original.vehicles; }
});

test('membership response requests distinguish dashboard KPIs, seven-day expiry and requested visible fields', () => {
  const { membershipResponseOptions, isMembershipDashboardSummary } = require('../services/aiCopilot/membershipResponses');
  assert.deepEqual(membershipResponseOptions('VIP statistics: Expiring Soon and Pending Transfers').kpis, ['expiringSoon', 'pendingTransfers']);
  assert.deepEqual(membershipResponseOptions('VIP statistics: expiring within 7 days').kpis, ['expiringWithin7Days']);
  assert.deepEqual(membershipResponseOptions('VIP total renewal amount').kpis, ['renewalAmount']);
  assert.deepEqual(membershipResponseOptions('VIP statistics: Pending subscriptions').kpis, ['pending']);
  const options = membershipResponseOptions('Find cancelled memberships with expiry dates and linked vehicle plates');
  assert.equal(options.includeExpiry, true); assert.equal(options.includeVehicles, true);
  for (const scope of [' for my account', ' for user member@example.test', ' for package Monthly VIP']) {
    const prompt = `Show VIP membership KPIs: Total VIP, Active, Expiring Soon, and Pending Transfers${scope}`;
    assert.equal(isMembershipDashboardSummary(prompt, membershipResponseOptions(prompt)), false);
  }
});
