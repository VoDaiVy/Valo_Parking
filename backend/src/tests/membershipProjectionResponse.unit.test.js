const test = require('node:test');
const assert = require('node:assert/strict');
const User = require('../models/User');
const Subscription = require('../models/Subscription');
const Entitlement = require('../models/MembershipSlotEntitlement');
const Renewal = require('../models/MembershipEntitlementRenewal');
const Floor = require('../models/ParkingFloor');
const payosPath = require.resolve('../config/payos');
const originalPayos = require.cache[payosPath];
require.cache[payosPath] = { id: payosPath, filename: payosPath, loaded: true, exports: {} };
const controller = require('../controllers/subscriptionController');
require('../services/membershipEntitlementRenewalService');
if (originalPayos) require.cache[payosPath] = originalPayos; else delete require.cache[payosPath];

// Reproduce Mongoose population of a missing foreign document, including its
// transform callback. Without preservation, the controller produces two B1s.
function query(value) {
  const data = structuredClone(value);
  return {
    select() { return this; }, sort() { return this; },
    populate(option) {
      const path = typeof option === 'string' ? option : option.path;
      if (path === 'floorId' || path === 'slots.floorId') {
        for (const row of path === 'floorId' ? data : data.flatMap((sub) => sub.slots)) {
          row.floorId = option.transform ? option.transform(null, row.floorId) : null;
        }
      }
      return this;
    },
    lean: async () => data,
    then(resolve, reject) { return Promise.resolve(data).then(resolve, reject); },
  };
}

test('actual membership controller returns one B1, exact IDs and disabled actions for dangling migrated space', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-22T10:39:00Z') });
  const previous = process.env.SUBSCRIPTION_RENEWAL_ENABLED;
  process.env.SUBSCRIPTION_RENEWAL_ENABLED = 'true';
  t.after(() => { if (previous === undefined) delete process.env.SUBSCRIPTION_RENEWAL_ENABLED; else process.env.SUBSCRIPTION_RENEWAL_ENABLED = previous; });
  const ownerId = '507f1f77bcf86cd799439011';
  const entitlement = {
    _id: '507f1f77bcf86cd7950fc99d', sourceSubscriptionId: '507f1f77bcf86cd7f3cbea84', ownerId,
    floorId: '507f1f77bcf86cd799e6cbf2', slotId: '507f1f77bcf86cd785ec70fe', slotCode: 'B1',
    status: 'active', expireAt: new Date('2026-10-22T13:42:46.553Z'), transferCount: 0,
    packageId: { type: 'monthly', price: 50000, renewalWindowDays: 7 },
  };
  const subscription = { _id: entitlement.sourceSubscriptionId, slots: [{ floorId: entitlement.floorId, slotCode: 'B1' }], expireAt: entitlement.expireAt, ticketPackage: entitlement.packageId };
  t.mock.method(User, 'findById', () => query({ membership: {} }));
  t.mock.method(Subscription, 'find', () => query([subscription]));
  t.mock.method(Entitlement, 'find', () => query([entitlement]));
  t.mock.method(Entitlement, 'findOne', () => query(entitlement));
  t.mock.method(Renewal, 'findOne', () => query(null));
  t.mock.method(Floor, 'findById', () => query(null));
  let response;
  await controller.getMembership({ user: { _id: ownerId } }, { status() { return this; }, json(value) { response = value; } }, (error) => { throw error; });
  assert.equal(response.data.entitlementCount, 1);
  assert.equal(response.data.reservedSlots.length, 1);
  const card = response.data.reservedSlots[0];
  assert.equal(card.entitlementId, entitlement._id);
  assert.equal(card.sourceSubscriptionId, subscription._id);
  assert.equal(card.floorId, entitlement.floorId);
  assert.equal(card.slotId, entitlement.slotId);
  assert.equal(card.canTransfer, false);
  assert.match(card.transferUnavailableReason, /floor no longer exists/);
  assert.equal(card.renewal.canRenew, false);
  assert.equal(card.renewal.reasonCode, 'MEMBERSHIP_FLOOR_NOT_FOUND');
});
