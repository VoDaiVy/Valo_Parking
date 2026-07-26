const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildAdminSubscriptionProjection,
} = require('../services/adminSubscriptionProjectionService');

test('uses the entitlement owner as the current owner after a transfer', () => {
  const [result] = buildAdminSubscriptionProjection({
    subscriptions: [
      {
        _id: 'subscription-1',
        user: null,
        slots: [{ slotCode: 'B1' }],
      },
    ],
    entitlements: [
      {
        sourceSubscriptionId: 'subscription-1',
        ownerId: {
          _id: 'current-user',
          username: 'anh_khoi_8847',
          email: 'khoitha0910@gmail.com',
        },
      },
    ],
    vehicles: [
      {
        owner: 'current-user',
        licensePlate: '43A-12345',
      },
    ],
  });

  assert.equal(result.user, null);
  assert.equal(result.originalUser, null);
  assert.equal(result.currentOwner.username, 'anh_khoi_8847');
  assert.deepEqual(result.currentOwner.vehicles, ['43A-12345']);
  assert.equal(result.currentOwners.length, 1);
});

test('keeps multiple current owners separate for multi-slot subscriptions', () => {
  const [result] = buildAdminSubscriptionProjection({
    subscriptions: [
      {
        _id: 'subscription-1',
        user: {
          _id: 'original-user',
          username: 'original',
          email: 'original@example.com',
        },
      },
    ],
    entitlements: [
      {
        sourceSubscriptionId: 'subscription-1',
        ownerId: { _id: 'owner-1', username: 'owner-one' },
      },
      {
        sourceSubscriptionId: 'subscription-1',
        ownerId: { _id: 'owner-2', username: 'owner-two' },
      },
    ],
  });

  assert.equal(result.currentOwner, null);
  assert.equal(result.currentOwners.length, 2);
  assert.equal(result.originalUser.username, 'original');
});

test('falls back to the original purchaser before entitlements are activated', () => {
  const [result] = buildAdminSubscriptionProjection({
    subscriptions: [
      {
        _id: 'pending-subscription',
        user: {
          _id: 'purchaser',
          username: 'pending-user',
        },
      },
    ],
  });

  assert.equal(result.currentOwner, null);
  assert.deepEqual(result.currentOwners, []);
  assert.equal(result.user.username, 'pending-user');
  assert.deepEqual(result.user.vehicles, []);
});
