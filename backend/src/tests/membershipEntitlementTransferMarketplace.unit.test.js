const test = require('node:test');
const assert = require('node:assert/strict');

const MembershipEntitlementTransfer = require('../models/MembershipEntitlementTransfer');
const {
  OPEN_STATUSES,
  calculateTransferPricing,
  getExpiredTransferResolution,
  toMarketplaceItem,
} = require('../services/membershipEntitlementTransferService');

test('marketplace schema keeps direct compatibility and supports public listing state', () => {
  const schema = MembershipEntitlementTransfer.schema;
  assert.equal(schema.path('mode').options.default, 'DIRECT');
  assert.notEqual(schema.path('toUserId').isRequired, true);
  assert.ok(schema.path('status').enumValues.includes('LISTED'));
  assert.ok(OPEN_STATUSES.includes('LISTED'));
});

test('one-open-transfer index includes public listings', () => {
  const index = MembershipEntitlementTransfer.schema
    .indexes()
    .find(([, options]) => options.name === 'one_open_transfer_per_entitlement_v2');
  assert.ok(index);
  assert.equal(index[1].unique, true);
  assert.ok(
    index[1].partialFilterExpression.status.$in.includes('LISTED')
  );
});

test('public marketplace uses the existing transfer pricing policy', () => {
  const quote = calculateTransferPricing(
    {
      validFrom: new Date('2026-07-01T00:00:00.000Z'),
      expireAt: new Date('2026-07-31T00:00:00.000Z'),
      unitAmount: 3000000,
    },
    1200000,
    new Date('2026-07-16T00:00:00.000Z')
  );
  assert.equal(quote.remainingValue, 1500000);
  assert.equal(quote.askingPrice, 1200000);
  assert.equal(quote.transferFee, 75000);
});

test('marketplace projection hides seller identity and exposes hold only to its buyer', () => {
  const now = Date.now();
  const transfer = {
    _id: 'transfer-1',
    mode: 'PUBLIC',
    status: 'AWAITING_PAYMENT',
    fromUserId: { _id: 'seller-1', email: 'private@example.com' },
    toUserId: 'buyer-1',
    askingPrice: 100000,
    remainingValue: 120000,
    transferFee: 6000,
    listingExpiresAt: new Date(now + 60000),
    lockExpiresAt: new Date(now + 30000),
    entitlementId: {
      slotCode: 'B1',
      validFrom: new Date(now - 60000),
      expireAt: new Date(now + 86400000),
      floorId: {
        _id: 'floor-1',
        name: 'Floor 1',
        parkingLotID: {
          _id: 'lot-1',
          name: 'VALO Lot',
          address: 'Public address',
        },
      },
      packageId: { _id: 'package-1', name: 'Monthly', type: 'monthly' },
    },
  };

  const buyerView = toMarketplaceItem(transfer, 'buyer-1');
  const otherView = toMarketplaceItem(transfer, 'buyer-2');
  assert.equal(buyerView.canSettle, true);
  assert.equal(otherView.canSettle, false);
  assert.equal(buyerView.totalDue, 106000);
  assert.equal(JSON.stringify(buyerView).includes('private@example.com'), false);
  assert.equal(Object.hasOwn(buyerView, 'fromUserId'), false);
  assert.equal(Object.hasOwn(buyerView, 'toUserId'), false);
});

test('expired public hold relists only while its seven-day listing is still valid', () => {
  const now = new Date('2026-07-24T10:00:00.000Z');
  assert.equal(
    getExpiredTransferResolution(
      {
        mode: 'PUBLIC',
        listingExpiresAt: new Date('2026-07-24T10:01:00.000Z'),
      },
      now
    ),
    'RELIST'
  );
  assert.equal(
    getExpiredTransferResolution(
      {
        mode: 'PUBLIC',
        listingExpiresAt: new Date('2026-07-24T09:59:00.000Z'),
      },
      now
    ),
    'EXPIRE'
  );
  assert.equal(
    getExpiredTransferResolution(
      {
        mode: 'DIRECT',
        listingExpiresAt: new Date('2026-07-25T10:00:00.000Z'),
      },
      now
    ),
    'EXPIRE'
  );
});
