const test = require('node:test');
const assert = require('node:assert/strict');
const Floor = require('../models/ParkingFloor');
const Slot = require('../models/Slot');
const Entitlement = require('../models/MembershipSlotEntitlement');
const Renewal = require('../models/MembershipEntitlementRenewal');
const Vehicle = require('../models/Vehicle');
const wallet = require('../services/walletService');
const Subscription = require('../models/Subscription');
const SubscriptionRenewal = require('../models/SubscriptionRenewal');
const User = require('../models/User');
const { validateMembershipSpace } = require('../services/membershipSpaceValidationService');
const { APIError } = require('@payos/node');
const payosPath = require.resolve('../config/payos');
const cached = require.cache[payosPath];
let providerCalls = 0;
const providerError = new APIError(200, { code: '215', desc: 'Provider fixture rejection' });
require.cache[payosPath] = { id: payosPath, filename: payosPath, loaded: true, exports: { paymentRequests: { create: async () => { providerCalls++; throw providerError; } } } };
const service = require('../services/membershipEntitlementRenewalService');
const legacyService = require('../services/subscriptionRenewalService');
if (cached) require.cache[payosPath] = cached; else delete require.cache[payosPath];
const query = (value) => ({ select() { return this; }, session() { return this; }, populate() { return this; }, then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); } });

test('physical space validation rejects dangling/mismatched/layout/maintenance/ownership references; permits occupied reserved space', async (t) => {
  let floor, slot;
  t.mock.method(Floor, 'findById', () => query(floor));
  t.mock.method(Slot, 'findById', () => query(slot));
  const args = { floorId: 'floor', slotId: 'slot', slotCode: 'M1', ownerId: 'owner', entitlementId: 'ent' };
  const reset = () => {
    floor = { layoutData: { elements: [{ type: 'slot', name: 'M1' }] } };
    slot = { floorID: 'floor', slotNumber: 'M1', status: 'occupied', reservedFor: 'owner', reservedByEntitlementId: 'ent' };
  };
  for (const [change, expected] of [
    [() => { floor = null; }, 'MEMBERSHIP_FLOOR_NOT_FOUND'],
    [() => { slot = null; }, 'MEMBERSHIP_SLOT_NOT_FOUND'],
    [() => { slot.floorID = 'other'; }, 'MEMBERSHIP_SPACE_MISMATCH'],
    [() => { slot.slotNumber = 'B1'; }, 'MEMBERSHIP_SPACE_MISMATCH'],
    [() => { floor.layoutData.elements = []; }, 'MEMBERSHIP_LAYOUT_SLOT_INVALID'],
    [() => { floor.layoutData.elements.push({ type: 'slot', name: 'M1' }); }, 'MEMBERSHIP_LAYOUT_SLOT_INVALID'],
    [() => { slot.status = 'maintenance'; }, 'SLOT_UNDER_MAINTENANCE'],
    [() => { slot.reservedFor = 'new-owner'; }, 'MEMBERSHIP_SPACE_OWNERSHIP_MISMATCH'],
    [() => { slot.reservedByEntitlementId = 'other'; }, 'MEMBERSHIP_SPACE_OWNERSHIP_MISMATCH'],
  ]) {
    reset(); change();
    await assert.rejects(validateMembershipSpace(args), (error) => error.code === expected && error.statusCode === 409);
  }
  reset();
  assert.equal((await validateMembershipSpace(args)).slot, slot);
});

test('actual quote/wallet/PayOS paths block missing floor before writes or provider; provider 215 stays separate on valid space', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-20T03:00:00Z') });
  let floor = null, writes = 0, debits = 0;
  const entitlement = { _id: 'ent', ownerId: 'owner', floorId: 'floor', slotId: 'slot', slotCode: 'M1', expireAt: new Date('2026-10-22T13:42:00Z'), packageId: { type: 'monthly', price: 50000, renewalWindowDays: 7 } };
  t.mock.method(Floor, 'findById', () => query(floor));
  t.mock.method(Slot, 'findById', () => query({ floorID: 'floor', slotNumber: 'M1', reservedFor: 'owner', reservedByEntitlementId: 'ent' }));
  t.mock.method(Entitlement, 'findOne', () => query(entitlement));
  t.mock.method(Entitlement, 'countDocuments', async () => 1);
  t.mock.method(Vehicle, 'countDocuments', async () => 1);
  t.mock.method(Renewal, 'findOne', async () => null);
  let row;
  t.mock.method(Renewal, 'create', async (data) => { writes++; row = { ...data, save: async () => {} }; return row; });
  t.mock.method(wallet, 'debitWallet', async () => { debits++; });
  const args = { userId: 'owner', entitlementId: 'ent', idempotencyKey: 'fixture' };
  for (const action of [() => service.getQuote('owner', 'ent'), () => service.renewWithWallet(args), () => service.createPayosRenewal(args)]) {
    await assert.rejects(action(), { code: 'MEMBERSHIP_FLOOR_NOT_FOUND' });
  }
  assert.equal(writes, 0); assert.equal(debits, 0); assert.equal(providerCalls, 0);
  Renewal.findOne.mock.mockImplementation(async () => ({ entitlementId: 'ent', status: 'pending', payosCheckoutUrl: 'fixture-only' }));
  await assert.rejects(service.createPayosRenewal(args), { code: 'MEMBERSHIP_FLOOR_NOT_FOUND' });
  Renewal.findOne.mock.mockImplementation(async () => null);
  floor = { layoutData: { elements: [{ type: 'slot', name: 'M1' }] } };
  await assert.rejects(service.createPayosRenewal(args), (error) => error === providerError && error.code === '215' && error.status === 200);
  assert.equal(providerCalls, 1); assert.equal(row.status, 'failed'); assert.match(row.failureReason, /HTTP 200.*215/);
  assert.equal(entitlement.expireAt.toISOString(), '2026-10-22T13:42:00.000Z'); assert.equal(debits, 0);
});

test('legacy subscription quote and both payment methods also reject a missing floor without writes', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-20T03:00:00Z') });
  const subscription = { _id: 'sub', status: 'active', paymentStatus: 'paid', expireAt: new Date('2026-10-22T13:42:00Z'), ticketPackage: { _id: 'pkg', type: 'monthly', price: 50000 }, slots: [{ floorId: 'floor', slotCode: 'M1' }] };
  t.mock.method(Subscription, 'findOne', () => query(subscription));
  t.mock.method(Entitlement, 'countDocuments', () => query(0));
  t.mock.method(User, 'findById', () => query({ status: 'active' }));
  t.mock.method(Vehicle, 'countDocuments', () => query(1));
  t.mock.method(SubscriptionRenewal, 'findOne', () => query(null));
  t.mock.method(Slot, 'find', () => query([{ _id: 'slot', floorID: 'floor', slotNumber: 'M1' }]));
  t.mock.method(Floor, 'findById', () => query(null));
  t.mock.method(SubscriptionRenewal, 'create', async () => { assert.fail('must not write renewal'); });
  const args = { userId: 'owner', subscriptionId: 'sub', idempotencyKey: 'fixture' };
  for (const action of [() => legacyService.getRenewalQuote('owner', 'sub'), () => legacyService.renewWithWallet(args), () => legacyService.createPayosRenewal(args)]) {
    await assert.rejects(action(), { code: 'MEMBERSHIP_FLOOR_NOT_FOUND' });
  }
});

test('local diagnostics separate route and IDs without request secrets or provider payloads', (t) => {
  const diagnose = require('../utils/membershipErrorDiagnostics');
  const originalEnv = process.env.NODE_ENV;
  t.after(() => { if (originalEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = originalEnv; });
  process.env.NODE_ENV = 'development';
  const output = [];
  t.mock.method(console, 'warn', (...args) => output.push(args.join(' ')));
  const req = { method: 'GET', baseUrl: '/api/subscriptions', route: { path: '/entitlements/:entitlementId/details' }, params: { entitlementId: 'fixture-id' }, body: { token: 'SECRET' }, headers: { authorization: 'SECRET' } };
  diagnose(req, Object.assign(new Error('SECRET'), { code: 'MEMBERSHIP_UNAVAILABLE' }));
  assert.match(output[0], /fixture-id/); assert.match(output[0], /entitlements/); assert.doesNotMatch(output[0], /SECRET/);
  process.env.NODE_ENV = 'production'; diagnose(req, providerError); assert.equal(output.length, 1);
});
