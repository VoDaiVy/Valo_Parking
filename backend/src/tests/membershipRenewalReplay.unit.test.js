const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const Entitlement = require('../models/MembershipSlotEntitlement');
const Renewal = require('../models/MembershipEntitlementRenewal');
const SubscriptionRenewal = require('../models/SubscriptionRenewal');
const Subscription = require('../models/Subscription');
const Slot = require('../models/Slot');
const Floor = require('../models/ParkingFloor');
const Vehicle = require('../models/Vehicle');
const wallet = require('../services/walletService');
const notifications = require('../services/membershipNotifications');
const projection = require('../services/membershipProjectionService');
const payosPath = require.resolve('../config/payos');
const previousPayos = require.cache[payosPath];
const fakePayos = { paymentRequests: { create: async () => { throw new Error('Unexpected payment call'); } } };
require.cache[payosPath] = { id: payosPath, filename: payosPath, loaded: true, exports: fakePayos };
const originalProjection = projection.recomputeUserMembership;
projection.recomputeUserMembership = async () => {};
const service = require('../services/membershipEntitlementRenewalService');
const legacy = require('../services/subscriptionRenewalService');
projection.recomputeUserMembership = originalProjection;
if (previousPayos) require.cache[payosPath] = previousPayos; else delete require.cache[payosPath];

const userId = '507f1f77bcf86cd799439011';
const id = '507f1f77bcf86cd799439012';
const args = { userId, entitlementId: id, idempotencyKey: 'phase2-replay-fixture' };
const query = (value) => ({ populate() { return this; }, select() { return this; }, session() { return this; }, then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); } });

function fixture(t) {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-22T03:00:00Z') });
  const entity = { _id: id, ownerId: userId, sourceSubscriptionId: id, slotId: id, floorId: id, slotCode: 'E8', status: 'active', expireAt: new Date('2026-10-25T03:00:00Z'), packageId: { _id: id, name: 'Monthly', type: 'monthly', price: 50000, renewalWindowDays: 7 } };
  const state = { row: null, creates: 0, debits: 0, commits: 0, notices: 0, slotUpdates: 0, subscriptionUpdates: 0 };
  t.mock.method(Entitlement, 'findOne', () => query(entity));
  t.mock.method(Floor, 'findById', () => query({ layoutData: { elements: [{ type: 'slot', name: 'E8' }] } }));
  t.mock.method(Slot, 'findById', () => query({ floorID: id, slotNumber: 'E8', reservedFor: userId, reservedByEntitlementId: id, reservedBySubscriptionId: id }));
  t.mock.method(Entitlement, 'countDocuments', async () => 1);
  t.mock.method(Vehicle, 'countDocuments', async () => 1);
  t.mock.method(Renewal, 'findOne', async (filter) => { assert.equal(filter.userId, userId); assert.equal(filter.idempotencyKey, args.idempotencyKey); return state.row; });
  t.mock.method(Renewal, 'create', async (data) => {
    state.creates++;
    state.row = { ...(Array.isArray(data) ? data[0] : data), _id: id, save: async () => {} };
    return Array.isArray(data) ? [state.row] : state.row;
  });
  t.mock.method(mongoose, 'startSession', async () => ({ startTransaction() {}, async commitTransaction() { state.commits++; }, async abortTransaction() {}, async endSession() {} }));
  t.mock.method(wallet, 'debitWallet', async (_user, amount, _description, options) => {
    assert.equal(_user, userId); assert.equal(amount, 50000); assert.ok(options.session);
    state.debits++; return { transaction: { _id: id }, newBalance: 100000 };
  });
  t.mock.method(Entitlement, 'findOneAndUpdate', async (filter, update, options) => {
    assert.equal(filter.ownerId, userId); assert.equal(filter.expireAt, entity.expireAt); assert.ok(options.session);
    entity.expireAt = update.$set.expireAt; return entity;
  });
  t.mock.method(Slot, 'updateOne', async (filter, update, options) => {
    assert.equal(filter.reservedFor, userId); assert.equal(filter.reservedByEntitlementId, id); assert.ok(options.session);
    assert.equal(update.$set.reservedUntil.toISOString(), '2026-11-25T03:00:00.000Z');
    state.slotUpdates++; return { matchedCount: 1 };
  });
  t.mock.method(Subscription, 'updateOne', async (_filter, update, options) => {
    assert.ok(options.session); assert.equal(update.$set.paymentStatus, 'paid');
    assert.equal(update.$max.expireAt.toISOString(), '2026-11-25T03:00:00.000Z'); state.subscriptionUpdates++;
  });
  t.mock.method(notifications, 'notifyRenewal', async (row) => {
    assert.equal(state.commits, 1); assert.equal(row.status, 'paid'); assert.equal(row.notificationPending, true); state.notices++;
  });
  return { state, entity };
}

test('Wallet renewal updates entitlement/slot/subscription once and paid replay never debits again (mocked transaction)', async (t) => {
  const { state, entity } = fixture(t);
  const original = await service.renewWithWallet(args);
  assert.equal(original.alreadyProcessed, false);
  assert.equal(entity.expireAt.toISOString(), '2026-11-25T03:00:00.000Z');
  const replay = await service.renewWithWallet(args);
  assert.equal(replay.alreadyProcessed, true);
  for (const field of ['renewalId', 'entitlementId', 'status', 'amount', 'oldExpireAt', 'newExpireAt', 'paymentMethod']) assert.deepEqual(replay[field], original[field]);
  assert.deepEqual([state.creates, state.debits, state.commits, state.notices, state.slotUpdates, state.subscriptionUpdates], [1, 1, 1, 1, 1, 1]);
});

test('pending Wallet request and paid/pending legacy replay do not start another debit', async (t) => {
  const { state } = fixture(t);
  state.row = { status: 'pending' };
  await assert.rejects(service.renewWithWallet(args), { code: 'RENEWAL_EXISTS' });
  t.mock.method(SubscriptionRenewal, 'findOne', async () => state.row);
  const request = { userId, subscriptionId: id, idempotencyKey: args.idempotencyKey };
  await assert.rejects(legacy.renewWithWallet(request), { code: 'RENEWAL_REQUEST_EXISTS' });
  state.row = { _id: id, status: 'paid', subscriptionId: id };
  assert.equal((await legacy.renewWithWallet(request)).alreadyProcessed, true);
  assert.equal(state.debits, 0); assert.equal(state.commits, 0); assert.equal(state.creates, 0);
});

test('PayOS link creation remains pending; replay reuses link and rejects another entitlement (mock provider)', async (t) => {
  const { state, entity } = fixture(t);
  let providerCalls = 0;
  t.mock.method(fakePayos.paymentRequests, 'create', async (payload) => {
    providerCalls++;
    assert.equal(new URL(payload.returnUrl).searchParams.get('entitlementId'), id);
    assert.equal(new URL(payload.cancelUrl).searchParams.get('entitlementId'), id);
    return { paymentLinkId: 'fixture', checkoutUrl: 'https://example.test/fixture' };
  });
  const originalExpiry = entity.expireAt;
  const first = await service.createPayosRenewal(args);
  const replay = await service.createPayosRenewal(args);
  assert.equal(first.status, 'pending'); assert.equal(replay.status, 'pending');
  assert.equal(replay.checkoutUrl, first.checkoutUrl); assert.equal(providerCalls, 1); assert.equal(state.creates, 1);
  assert.equal(entity.expireAt, originalExpiry); assert.equal(state.debits, 0); assert.equal(state.notices, 0);
  await assert.rejects(service.createPayosRenewal({ ...args, entitlementId: userId }), { code: 'RENEWAL_ENTITLEMENT_MISMATCH' });
  assert.equal(providerCalls, 1);
});

// Real Wallet -> post-commit producer -> atomic notification delivery -> API/socket,
// with in-memory Mongo substitutes only. No database or provider is contacted.
function notificationFixture(t, state, entity) {
  const Notification = require('../models/Notification');
  const Inbox = require('../models/UserNotification');
  const delivery = require('../services/membershipNotificationDeliveryService');
  const apiService = require('../services/notificationService');
  const controller = require('../controllers/notificationController');
  const sockets = require('../sockets/notificationSocket');
  const { createMembershipNotificationDelivery } = delivery;
  let stored = { notices: [], inbox: [], logs: [] }; let failure = '';
  const emitted = [];
  const lookup = (get) => ({ session() { return this; }, select() { return this; }, lean: async () => get(), then: (yes, no) => Promise.resolve(get()).then(yes, no) });
  const session = { async withTransaction(fn) { const before = JSON.parse(JSON.stringify(stored)); try { await fn(); } catch (error) { stored = before; throw error; } }, async endSession() {} };
  const durable = createMembershipNotificationDelivery({
    startSession: async () => session,
    User: { findOne: (filter) => { assert.equal(String(filter._id), userId); return lookup(() => ({ _id: userId })); } },
    Log: {
      findOne: (filter) => lookup(() => stored.logs.find((row) => row.eventType === filter.eventType && row.referenceId === filter.referenceId)),
      updateOne: async (filter, update) => { if (failure === 'log') throw new Error('fixture log failure'); stored.logs = [{ ...filter, ...update.$set }]; },
    },
    Notification: {
      findOne: (filter) => lookup(() => stored.notices.find((row) => row.metadata.referenceId === filter['metadata.referenceId'] && (!filter._id || String(row._id) === String(filter._id)))),
      create: async ([data]) => { assert.equal(state.commits, 1, 'notification is created after payment commit'); if (failure === 'notice') throw new Error('fixture persistence failure'); const doc = new Notification(data); await doc.validate(); const row = doc.toObject(); stored.notices.push(row); return [row]; },
    },
    Inbox: { updateOne: async (filter, update) => { if (failure === 'inbox') throw new Error('fixture inbox failure'); if (!stored.inbox.some((row) => String(row.notificationId) === String(filter.notificationId))) stored.inbox.push({ ...update.$setOnInsert, createdAt: new Date() }); } },
  });
  t.mock.method(delivery, 'deliver', (...args) => durable.deliver(...args));
  t.mock.method(Entitlement, 'populate', async (record) => { record.floorId = { name: 'Floor 2', floorNumber: 2 }; return record; });
  t.mock.method(Renewal, 'updateOne', async (filter, update) => { assert.equal(String(filter._id), String(state.row._id)); Object.assign(state.row, update.$set); });
  t.mock.method(Renewal, 'find', () => ({ sort() { return this; }, limit: async () => state.row?.notificationPending ? [state.row] : [] }));
  t.mock.method(SubscriptionRenewal, 'find', () => ({ sort() { return this; }, limit: async () => [] }));
  t.mock.method(Inbox, 'aggregate', async (pipeline) => {
    assert.equal(String(pipeline[0].$match.userId), userId);
    assert.ok(pipeline.some((stage) => stage.$match?.['notification.isRevoked'] === false));
    const rows = stored.inbox.filter((row) => String(row.userId) === userId).map((inbox) => {
      const notice = stored.notices.find((row) => String(row._id) === String(inbox.notificationId));
      return { ...inbox, ...notice, notificationId: notice._id };
    });
    return pipeline.some((stage) => stage.$count) ? [{ total: rows.length, count: rows.length }] : rows;
  });
  const socketId = 'fixture-customer-socket';
  sockets.onlineUsers.set(userId, new Set([socketId]));
  t.after(() => sockets.onlineUsers.delete(userId));
  const io = { to: () => ({ emit: (event, data) => emitted.push({ event, data }) }), sockets: { sockets: new Map([[socketId, { userRole: 'customer', emit: (event, data) => emitted.push({ event, data }) }]]) } };
  entity.packageId.name = 'Premium Monthly';
  return {
    app: { get: (key) => key === 'io' ? io : null }, emitted,
    stored: () => stored, fail: (stage) => { failure = stage; },
    api: async () => { let result; await controller.getUserNotifications({ user: { _id: userId, role: 'customer' }, query: { page: '1', limit: '5' } }, { status() { return this; }, json(data) { result = data; } }, (error) => { throw error; }); return result; },
    apiService,
  };
}

test('Wallet commits one SUCCESS inbox record for owner/renewal; API and realtime expose it; replay is deduplicated', async (t) => {
  const notify = notifications.notifyRenewal;
  const { state, entity } = fixture(t);
  t.mock.method(notifications, 'notifyRenewal', notify);
  const f = notificationFixture(t, state, entity);
  await service.renewWithWallet({ ...args, app: f.app });
  assert.equal(state.debits, 1); assert.equal(state.row.notificationPending, false);
  assert.equal(f.stored().notices.length, 1); assert.equal(f.stored().inbox.length, 1);
  const notice = f.stored().notices[0];
  assert.equal(notice.title, 'Membership renewed successfully'); assert.equal(notice.priority, 'SUCCESS');
  assert.deepEqual(notice.targetUsers.map(String), [userId]);
  assert.equal(notice.metadata.eventType, 'MEMBERSHIP_ENTITLEMENT_RENEWAL_SUCCESS');
  assert.equal(notice.metadata.entitlementId, id); assert.equal(notice.metadata.renewalId, id);
  assert.equal(notice.metadata.packageName, 'Premium Monthly'); assert.equal(notice.metadata.slotCode, 'E8');
  assert.equal(notice.metadata.floorName, 'Floor 2'); assert.equal(notice.metadata.expireAt.toISOString(), entity.expireAt.toISOString());
  assert.ok(notice.content.includes('25 Nov 2026, 10:00')); assert.ok(!notice.content.includes('GMT'));
  assert.equal((await f.api()).data[0].priority, 'SUCCESS');
  assert.equal(f.emitted.filter((row) => row.event === 'notification:new').length, 1);
  await service.renewWithWallet({ ...args, app: f.app });
  // Scheduler or a duplicate producer invocation must not duplicate persistence.
  await notify({ ...state.row, notificationPending: true }, 'entitlement', f.app);
  assert.equal(state.debits, 1); assert.equal(f.stored().notices.length, 1); assert.equal(f.stored().inbox.length, 1);
});

test('notification persistence/inbox failure leaves a paid retry marker; recovery never debits Wallet again', async (t) => {
  const notify = notifications.notifyRenewal;
  const { state, entity } = fixture(t);
  t.mock.method(notifications, 'notifyRenewal', notify);
  const f = notificationFixture(t, state, entity); f.fail('inbox');
  const response = await service.renewWithWallet({ ...args, app: f.app });
  assert.equal(response.status, 'paid'); assert.equal(state.debits, 1);
  assert.equal(state.row.notificationPending, true); assert.equal(f.stored().notices.length, 0);
  await service.renewWithWallet({ ...args, app: f.app }); assert.equal(state.debits, 1);
  f.fail(''); await notifications.retryPending(f.app);
  assert.equal(state.debits, 1); assert.equal(state.row.notificationPending, false);
  assert.equal(f.stored().notices.length, 1); assert.equal((await f.api()).data.length, 1);
});

test('notification creation failure after paid commit is recoverable without a second charge', async (t) => {
  const notify = notifications.notifyRenewal;
  const { state, entity } = fixture(t);
  t.mock.method(notifications, 'notifyRenewal', notify);
  const f = notificationFixture(t, state, entity); f.fail('notice');
  assert.equal((await service.renewWithWallet({ ...args, app: f.app })).status, 'paid');
  assert.equal(state.debits, 1); assert.equal(state.row.notificationPending, true);
  await service.renewWithWallet({ ...args, app: f.app }); assert.equal(state.debits, 1);
  f.fail(''); await notifications.retryPending(f.app);
  assert.equal(state.debits, 1); assert.equal(f.stored().notices.length, 1);
});

// Testing phase: exercise the real Wallet balance check, using only model mocks.
test('insufficient/frozen Wallet rejects renewal before entitlement updates, commit or notification', async (t) => {
  const debit = wallet.debitWallet;
  const { state, entity } = fixture(t);
  const Wallet = require('../models/Wallet');
  const Transaction = require('../models/WalletTransaction');
  t.mock.method(wallet, 'debitWallet', debit);
  let record = { _id: id, balance: 49999, status: 'active' }; let aborts = 0;
  const oldExpiry = entity.expireAt.toISOString();
  t.mock.method(Wallet, 'findOne', (filter) => { assert.equal(filter.userId, userId); return query(record); });
  t.mock.method(Transaction, 'create', async () => { assert.fail('must not create a charge'); });
  t.mock.method(Wallet, 'findByIdAndUpdate', async () => { assert.fail('must not update balance'); });
  t.mock.method(mongoose, 'startSession', async () => ({ startTransaction() {}, async commitTransaction() { assert.fail('must not commit'); }, async abortTransaction() { aborts++; state.row = null; }, async endSession() {} }));
  await assert.rejects(service.renewWithWallet(args), (error) => error.statusCode === 400 && /Insufficient wallet balance/.test(error.message));
  record = { ...record, balance: 50000, status: 'frozen' };
  await assert.rejects(service.renewWithWallet(args), (error) => error.statusCode === 403 && /frozen/.test(error.message));
  assert.equal(aborts, 2); assert.equal(entity.expireAt.toISOString(), oldExpiry);
  assert.deepEqual([state.slotUpdates, state.subscriptionUpdates, state.notices], [0, 0, 0]);
});

test('foreign owner cannot quote or renew an entitlement; query is scoped before payment', async (t) => {
  const { state } = fixture(t);
  const foreign = '507f1f77bcf86cd799439099';
  t.mock.method(Renewal, 'findOne', async (filter) => { assert.equal(filter.userId, foreign); return null; });
  t.mock.method(Entitlement, 'findOne', (filter) => {
    assert.equal(filter._id, id); assert.equal(filter.ownerId, foreign);
    assert.equal(filter.status, 'active'); assert.ok(filter.expireAt.$gt instanceof Date);
    return query(null);
  });
  await assert.rejects(service.getQuote(foreign, id), { code: 'ENTITLEMENT_NOT_FOUND' });
  await assert.rejects(service.renewWithWallet({ ...args, userId: foreign }), { code: 'ENTITLEMENT_NOT_FOUND' });
  assert.deepEqual([state.creates, state.debits, state.commits, state.notices], [0, 0, 0, 0]);
});

test('concurrent Wallet requests cannot both charge when the existing pending-renewal unique constraint rejects one (simulated)', async (t) => {
  const { state } = fixture(t);
  let entered = 0, release;
  const barrier = new Promise((resolve) => { release = resolve; });
  t.mock.method(Renewal, 'findOne', async () => { if (++entered === 2) release(); await barrier; return null; });
  t.mock.method(Renewal, 'create', async ([data]) => {
    if (state.row) throw Object.assign(new Error('fixture one_pending_renewal_per_entitlement duplicate'), { code: 11000 });
    state.creates++; state.row = { ...data, _id: id, save: async () => {} }; return [state.row];
  });
  const results = await Promise.allSettled([
    service.renewWithWallet(args),
    service.renewWithWallet({ ...args, idempotencyKey: 'second-concurrent-fixture-key' }),
  ]);
  assert.equal(results.filter((row) => row.status === 'fulfilled').length, 1);
  assert.equal(results.filter((row) => row.status === 'rejected').length, 1);
  assert.deepEqual([state.debits, state.commits, state.notices], [1, 1, 1]);
});

test('regression: a paid Wallet idempotency key cannot be replayed for a different entitlement', async (t) => {
  const { state, entity } = fixture(t);
  await service.renewWithWallet(args);
  const before = { expiry: entity.expireAt.toISOString(), creates: state.creates, debits: state.debits, notices: state.notices, commits: state.commits, slotUpdates: state.slotUpdates, subscriptionUpdates: state.subscriptionUpdates };
  await assert.rejects(service.renewWithWallet({ ...args, entitlementId: '507f1f77bcf86cd799439099' }), { code: 'RENEWAL_ENTITLEMENT_MISMATCH', statusCode: 409 });
  assert.deepEqual({ expiry: entity.expireAt.toISOString(), creates: state.creates, debits: state.debits, notices: state.notices, commits: state.commits, slotUpdates: state.slotUpdates, subscriptionUpdates: state.subscriptionUpdates }, before);
});

test('ownership transfer between quote and transaction blocks Wallet before creating a renewal or charge', async (t) => {
  const { state } = fixture(t);
  let validations = 0;
  t.mock.method(Slot, 'findById', () => query({ floorID: id, slotNumber: 'E8', reservedFor: ++validations === 1 ? userId : 'new-owner', reservedByEntitlementId: id, reservedBySubscriptionId: id }));
  await assert.rejects(service.renewWithWallet(args), { code: 'MEMBERSHIP_SPACE_OWNERSHIP_MISMATCH' });
  assert.equal(validations, 2);
  assert.deepEqual([state.creates, state.debits, state.commits, state.notices], [0, 0, 0, 0]);
});

test('paid Wallet replay requires matching owner and payment operation before returning any result', async (t) => {
  const { state } = fixture(t);
  // Defensive validation even if the data source violates its owner-scoped query.
  for (const mismatch of [{ userId: '507f1f77bcf86cd799439099', paymentMethod: 'wallet' }, { userId, paymentMethod: 'payos' }]) {
    state.row = { _id: id, entitlementId: id, status: 'paid', ...mismatch };
    await assert.rejects(service.renewWithWallet(args), { code: 'RENEWAL_CONTEXT_MISMATCH', statusCode: 409 });
  }
  assert.deepEqual([state.creates, state.debits, state.commits, state.notices, state.slotUpdates, state.subscriptionUpdates], [0, 0, 0, 0, 0, 0]);
});

test('pending, failed and cancelled Wallet keys remain closed without payment or lifecycle writes', async (t) => {
  const { state } = fixture(t);
  for (const status of ['pending', 'failed', 'cancelled']) {
    state.row = { _id: id, entitlementId: id, userId, status, paymentMethod: 'wallet' };
    await assert.rejects(service.renewWithWallet(args), { code: 'RENEWAL_EXISTS', statusCode: 409 });
  }
  assert.deepEqual([state.creates, state.debits, state.commits, state.notices], [0, 0, 0, 0]);
});
