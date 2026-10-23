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
  assert.equal((await service.renewWithWallet(args)).alreadyProcessed, false);
  assert.equal(entity.expireAt.toISOString(), '2026-11-25T03:00:00.000Z');
  assert.equal((await service.renewWithWallet(args)).alreadyProcessed, true);
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
