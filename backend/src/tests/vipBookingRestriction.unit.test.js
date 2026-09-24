const assert = require('node:assert/strict');
const test = require('node:test');
const { findForeignVipPlateRestriction, findVipRegisteredVehicleBookingRestriction, vipBookingRestrictionMessage } = require('../services/vipBookingRestrictionService');

const start = new Date('2099-01-15T01:00:00Z');
const request = {
  userId: 'user-1', licensePlate: '43A-123.45', floorId: 'floor-2',
  slotCode: 'A-015', start, end: new Date('2099-01-15T02:00:00Z'),
};

const query = (value) => ({ select() { return this; }, lean: async () => value });
const setup = ({
  type = 'monthly', expireAt = '2099-02-01T00:00:00Z',
  isVip = true, approved = true, ownerId = null,
  entitlementExpireAt = '2099-02-01T00:00:00Z',
} = {}) => {
  const calls = [];
  return {
    calls,
    dependencies: {
      User: { findById: () => query({ membership: { isVip, expireAt, packageId: 'package-1' } }) },
      Vehicle: { findOne: (filter) => {
        calls.push({ kind: 'vehicle', filter });
        return query(approved ? { _id: 'vehicle-1', licensePlate: '43A12345' } : null);
      } },
      TicketPackage: { findById: () => query({ type }) },
      findActiveSlotOwnership: async (filter) => {
        calls.push({ kind: 'ownership', filter });
        return ownerId ? { ownerId, expireAt: entitlementExpireAt } : null;
      },
    },
  };
};

for (const type of ['monthly', 'yearly']) {
  test(`${type} VIP blocks a registered vehicle from a normal parking slot`, async () => {
    const { dependencies, calls } = setup({ type });
    const result = await findVipRegisteredVehicleBookingRestriction(request, dependencies);
    assert.equal(result.membershipType, type);
    assert.deepEqual(calls.find((call) => call.kind === 'vehicle').filter, {
      owner: 'user-1', licensePlate: '43A12345', status: 'approved',
    });
  });
}

test('an active VIP entitlement allows its current owner to use the assigned slot', async () => {
  const { dependencies, calls } = setup({ ownerId: 'user-1' });
  const result = await findVipRegisteredVehicleBookingRestriction(request, dependencies);
  assert.equal(result, null);
  assert.deepEqual(calls.find((call) => call.kind === 'ownership').filter, {
    floorId: 'floor-2', slotCode: 'A-015', at: start,
  });
});

test('another account’s entitlement does not grant VIP-slot access', async () => {
  const { dependencies } = setup({ ownerId: 'user-2' });
  assert.ok(await findVipRegisteredVehicleBookingRestriction(request, dependencies));
});

test('an assigned VIP slot cannot be booked past its entitlement expiry', async () => {
  const { dependencies } = setup({ ownerId: 'user-1', entitlementExpireAt: '2099-01-15T01:30:00Z' });
  const result = await findVipRegisteredVehicleBookingRestriction(request, dependencies);
  assert.equal(result.reason, 'VIP_EXPIRES_DURING_BOOKING');
});

test('an assigned VIP slot can end exactly when its entitlement expires', async () => {
  const { dependencies } = setup({ ownerId: 'user-1', entitlementExpireAt: request.end.toISOString() });
  assert.equal(await findVipRegisteredVehicleBookingRestriction(request, dependencies), null);
});

test('VIP remains restricted from a normal slot even when no assigned slot can be found', async () => {
  const { dependencies } = setup();
  assert.ok(await findVipRegisteredVehicleBookingRestriction(request, dependencies));
});

test('VIP booking guidance is in Vietnamese and tells the customer how to continue', () => {
  assert.match(vipBookingRestrictionMessage({ membershipType: 'monthly' }, '43B20404'), /Xe 43B20404.*gói VIP.*biển số xe khác/);
  assert.match(vipBookingRestrictionMessage({ reason: 'VIP_EXPIRES_DURING_BOOKING' }, '43B20404'), /hết hạn.*gia hạn.*biển số xe khác/);
});

test('a plate with VIP ownership in another account is rejected at quote time', async () => {
  const deps = {
    Vehicle: { findOne: async () => ({ owner: 'other-user' }) },
    MembershipSlotEntitlement: { find: async () => [{ _id: 'entitlement-1' }] },
    Subscription: { findOne: async () => null },
  };
  const result = await findForeignVipPlateRestriction({ userId: 'user-1', licensePlate: '43B-204.04', at: start }, deps);
  assert.equal(result.licensePlate, '43B20404');
  deps.MembershipSlotEntitlement.find = async () => [];
  deps.Subscription.findOne = async () => ({ slots: ['slot-1'] });
  assert.equal((await findForeignVipPlateRestriction({ userId: 'user-1', licensePlate: '43B20404', at: start }, deps)).licensePlate, '43B20404');
  deps.Subscription.findOne = async () => null;
  assert.equal(await findForeignVipPlateRestriction({ userId: 'user-1', licensePlate: '43B20404', at: start }, deps), null);
  deps.Vehicle.findOne = async () => ({ owner: 'user-1' });
  assert.equal(await findForeignVipPlateRestriction({ userId: 'user-1', licensePlate: '43B20404', at: start }, deps), null);
});

test('a booking beginning after VIP expiry follows the normal booking rules', async () => {
  const { dependencies } = setup({ expireAt: '2099-01-14T23:59:59Z' });
  assert.equal(await findVipRegisteredVehicleBookingRestriction(request, dependencies), null);
});

test('VIP expires exactly at the requested start time', async () => {
  const { dependencies } = setup({ expireAt: start.toISOString() });
  assert.equal(await findVipRegisteredVehicleBookingRestriction(request, dependencies), null);
});

test('unapproved, non-VIP and hourly vehicles follow normal booking rules', async () => {
  for (const options of [{ approved: false }, { isVip: false }, { type: 'hourly' }]) {
    const { dependencies } = setup(options);
    assert.equal(await findVipRegisteredVehicleBookingRestriction(request, dependencies), null);
  }
});
