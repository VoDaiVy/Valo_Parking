const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const Transfer = require('../models/MembershipEntitlementTransfer');
const Entitlement = require('../models/MembershipSlotEntitlement');
const Floor = require('../models/ParkingFloor');
const Slot = require('../models/Slot');
const wallet = require('../services/walletService');
const service = require('../services/membershipEntitlementTransferService');
const query = (value) => ({ select() { return this; }, session() { return this; }, then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); } });

test('missing floor/slot blocks create, invitation acceptance, approval, claim and settlement before mutation or wallet', async (t) => {
  const entitlement = { _id: 'ent', ownerId: 'owner', floorId: 'floor', slotId: 'slot', slotCode: 'B1' };
  const transfer = { _id: 'transfer', entitlementId: 'ent', fromUserId: 'owner', toUserId: 'buyer', mode: 'DIRECT', askingPrice: 10000, transferFee: 500 };
  let floor = null, aborted = 0;
  t.mock.method(Entitlement, 'findOne', () => query(entitlement));
  t.mock.method(Transfer, 'findOne', () => query(transfer));
  t.mock.method(Floor, 'findById', () => query(floor));
  t.mock.method(Slot, 'findById', () => query(null));
  t.mock.method(Transfer.collection, 'indexes', async () => [{ name: 'one_open_transfer_per_entitlement_v2', unique: true, partialFilterExpression: { status: { $in: ['PENDING_RECIPIENT', 'PENDING_ADMIN', 'LISTED', 'AWAITING_PAYMENT'] } } }]);
  for (const [object, method] of [[Transfer, 'create'], [Transfer, 'findOneAndUpdate'], [Entitlement, 'findOneAndUpdate'], [wallet, 'debitWallet'], [wallet, 'creditWallet']]) {
    t.mock.method(object, method, async () => { assert.fail(`invalid space reached ${method}`); });
  }
  t.mock.method(mongoose, 'startSession', async () => ({ startTransaction() {}, async abortTransaction() { aborted++; }, async commitTransaction() { assert.fail('must not commit'); }, endSession() {} }));
  const actions = [
    () => service.createTransfer({ entitlementId: 'ent', fromUserId: 'owner', mode: 'DIRECT', toUserId: 'buyer' }),
    () => service.createTransfer({ entitlementId: 'ent', fromUserId: 'owner', mode: 'PUBLIC' }),
    () => service.acceptTransfer('transfer', 'buyer'),
    () => service.approveTransfer('transfer', 'admin'),
    () => service.claimMarketplaceListing('transfer', 'buyer'),
    () => service.settleTransfer('transfer', 'buyer'),
  ];
  for (const code of ['MEMBERSHIP_FLOOR_NOT_FOUND', 'MEMBERSHIP_SLOT_NOT_FOUND']) {
    for (const action of actions) await assert.rejects(action(), (error) => error.code === code && error.statusCode === 409 && error.message.startsWith('Transfer is unavailable:'));
    floor = { layoutData: { elements: [{ type: 'slot', name: 'B1' }] } };
  }
  assert.equal(aborted, 6);
});
