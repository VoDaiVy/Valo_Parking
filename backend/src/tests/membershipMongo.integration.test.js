const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { mkdtemp } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');

// Never read a database URI or production .env. This process may connect only
// to the mongod it creates below, using a unique database and temporary dbPath.
const payosPath = require.resolve('../config/payos');
require.cache[payosPath] = { id: payosPath, filename: payosPath, loaded: true, exports: { paymentRequests: new Proxy({}, { get: () => () => { throw new Error('External PayOS forbidden in integration tests'); } }) } };
const service = require('../services/membershipEntitlementRenewalService');
const notifications = require('../services/membershipNotifications');
const { _private: { addPackageDuration } } = require('../services/subscriptionEligibilityService');
const User = require('../models/User');
const Wallet = require('../models/Wallet');
const Transaction = require('../models/WalletTransaction');
const Entitlement = require('../models/MembershipSlotEntitlement');
const Renewal = require('../models/MembershipEntitlementRenewal');
const Subscription = require('../models/Subscription');
const SubscriptionRenewal = require('../models/SubscriptionRenewal');
const Floor = require('../models/ParkingFloor');
const Slot = require('../models/Slot');
const Vehicle = require('../models/Vehicle');
const Package = require('../models/TicketPackage');
const Notification = require('../models/Notification');
const Inbox = require('../models/UserNotification');
const EventLog = require('../models/NotificationEventLog');
const models = [User, Wallet, Transaction, Entitlement, Renewal, Subscription, SubscriptionRenewal, Floor, Slot, Vehicle, Package, Notification, Inbox, EventLog];

let sequence = 0;
async function seed(balance = 150000, spaces = 1) {
  const n = ++sequence;
  const owner = await User.create({ username: `integration_${n}`, email: `membership_${n}@example.invalid`, role: 'customer' });
  const wallet = await Wallet.create({ userId: owner._id, balance });
  const pkg = await Package.create({ name: 'Synthetic Monthly', type: 'monthly', price: 50000, renewalWindowDays: 7, isRenewable: true });
  const floor = await Floor.create({ floorNumber: n, layoutData: { elements: ['E8', 'E9'].map(name => ({ name, type: 'slot' })) } });
  const oldExpiry = new Date(Date.now() + 3 * 86400000);
  const subscription = await Subscription.create({ user: owner._id, ticketPackage: pkg._id, slots: ['E8', 'E9'].slice(0, spaces).map(slotCode => ({ floorId: floor._id, slotCode })), amount: 50000 * spaces, paymentStatus: 'paid', status: 'active', orderCode: n, validFrom: new Date(Date.now() - 27 * 86400000), expireAt: oldExpiry });
  const entitlements = [];
  for (let i = 0; i < spaces; i++) {
    await Vehicle.create({ owner: owner._id, licensePlate: `43A${10000 + n * 10 + i}`, vehicleType: 'car', brand: 'Synthetic', status: 'approved' });
    const slot = await Slot.create({ zoneID: new mongoose.Types.ObjectId(), floorID: floor._id, slotNumber: ['E8', 'E9'][i], gridX: i, gridY: 0, reservedFor: owner._id, reservedBySubscriptionId: subscription._id, reservedUntil: oldExpiry });
    const entitlement = await Entitlement.create({ ownerId: owner._id, sourceSubscriptionId: subscription._id, slotId: slot._id, floorId: floor._id, slotCode: slot.slotNumber, packageId: pkg._id, validFrom: subscription.validFrom, expireAt: oldExpiry, status: 'active', unitAmount: 50000 });
    await Slot.updateOne({ _id: slot._id }, { $set: { reservedByEntitlementId: entitlement._id } });
    entitlements.push(entitlement);
  }
  return { owner, wallet, subscription, entitlements, oldExpiry, newExpiry: addPackageDuration(oldExpiry, 'monthly'), balance, key: `isolated-wallet-${randomUUID()}` };
}
const request = (f, entitlement = f.entitlements[0]) => ({ userId: f.owner._id, entitlementId: entitlement._id, idempotencyKey: f.key });
async function snapshot(f) {
  return JSON.stringify({
    wallet: await Wallet.findById(f.wallet._id).lean(),
    owner: await User.findById(f.owner._id).lean(),
    subscription: await Subscription.findById(f.subscription._id).lean(),
    entitlements: await Entitlement.find({ ownerId: f.owner._id }).sort({ slotCode: 1 }).lean(),
    slots: await Slot.find({ reservedFor: f.owner._id }).sort({ slotNumber: 1 }).lean(),
    transactions: await Transaction.find({ userId: f.owner._id }).lean(),
    renewals: await Renewal.find({ userId: f.owner._id }).lean(),
    inbox: await Inbox.find({ userId: f.owner._id }).lean(),
    notifications: await Notification.find({ targetUsers: f.owner._id }).lean(),
    eventLogs: await EventLog.find({ referenceId: { $regex: String(f.owner._id) } }).lean(),
  });
}
async function assertOneRenewal(f) {
  const wallet = await Wallet.findById(f.wallet._id);
  assert.equal(wallet.balance, f.balance - 50000); assert.equal(wallet.totalSpent, 50000);
  const charge = await Transaction.findOne({ userId: f.owner._id, refSource: 'membership_entitlement_renewal' });
  assert.equal(charge.amount, 50000);
  assert.equal(await Transaction.countDocuments({ userId: f.owner._id, refSource: 'membership_entitlement_renewal', status: 'COMPLETED' }), 1);
  assert.equal(await Renewal.countDocuments({ userId: f.owner._id, status: 'paid' }), 1);
  assert.equal((await Entitlement.findById(f.entitlements[0]._id)).expireAt.toISOString(), f.newExpiry.toISOString());
  assert.equal((await Slot.findById(f.entitlements[0].slotId)).reservedUntil.toISOString(), f.newExpiry.toISOString());
  assert.equal((await Subscription.findById(f.subscription._id)).expireAt.toISOString(), f.newExpiry.toISOString());
  assert.equal((await User.findById(f.owner._id)).membership.expireAt.toISOString(), f.newExpiry.toISOString());
}

test('Membership Wallet integration on an owned disposable MongoDB replica set', { timeout: 300000 }, async (t) => {
  assert.equal(mongoose.connection.readyState, 0, 'BLOCKED: existing database connection detected');
  const dbName = `valo_membership_it_${randomUUID().replaceAll('-', '')}`;
  const replName = `membership_it_${randomUUID().slice(0, 8)}`;
  const dbPath = await mkdtemp(path.join(os.tmpdir(), 'valo-membership-it-'));
  let replica; let connected = false;
  try {
    replica = await MongoMemoryReplSet.create({
      binary: { version: '8.0.5', downloadDir: path.resolve(__dirname, '../../../.mongodb-binaries') },
      instanceOpts: [{ dbPath, args: ['--setParameter', 'enableTestCommands=1'] }],
      replSet: { count: 1, ip: '127.0.0.1', name: replName, dbName, storageEngine: 'wiredTiger' },
    });
    const uri = replica.getUri(dbName); const parsed = new URL(uri);
    assert.equal(parsed.protocol, 'mongodb:'); assert.equal(parsed.hostname, '127.0.0.1');
    assert.equal(decodeURIComponent(parsed.pathname.slice(1)), dbName);
    assert.equal(parsed.searchParams.get('replicaSet'), replName);
    assert.match(dbName, /^valo_membership_it_[a-f0-9]{32}$/); assert.notEqual(dbName, 'valo_parking');
    const owned = replica.servers[0].instanceInfo;
    assert.equal(Number(parsed.port), owned.port); assert.equal(path.resolve(owned.dbPath), path.resolve(dbPath));
    console.log(`[ISOLATION BEFORE CONNECT] ${uri} | owned temporary dbPath=${dbPath}`);
    await mongoose.connect(uri, { dbName, autoCreate: false, autoIndex: false, appName: 'valo-membership-isolated-integration', serverSelectionTimeoutMS: 15000 }); connected = true;
    assert.equal(mongoose.connection.name, dbName);
    const hello = await mongoose.connection.db.admin().command({ hello: 1 });
    assert.equal(hello.setName, replName); assert.equal(hello.isWritablePrimary, true);
    assert.deepEqual(await mongoose.connection.db.listCollections().toArray(), [], 'BLOCKED: disposable database is not empty');
    console.log(`[ISOLATION VERIFIED] db=${dbName}; replicaSet=${hello.setName}; initially empty; no environment URI used`);
    for (const model of models) { await model.createCollection(); await model.createIndexes(); }
    const fail = async (command) => mongoose.connection.db.admin().command({ configureFailPoint: 'failCommand', mode: { times: 1 }, data: { failCommands: [command], errorCode: 2, appName: 'valo-membership-isolated-integration' } });
    const clearFailure = async () => mongoose.connection.db.admin().command({ configureFailPoint: 'failCommand', mode: 'off' });

    await t.test('1 Wallet success: one debit, one extension, one Paid history and consistent projections', async () => {
      const f = await seed(); const result = await service.renewWithWallet(request(f));
      assert.equal(result.status, 'paid'); await assertOneRenewal(f);
      assert.equal((await Renewal.findOne({ userId: f.owner._id })).notificationPending, false);
      assert.equal(await Inbox.countDocuments({ userId: f.owner._id }), 1);
    });
    await t.test('2 insufficient balance: all database records remain unchanged', async () => {
      const f = await seed(49999); const before = await snapshot(f);
      await assert.rejects(service.renewWithWallet(request(f)), /Insufficient wallet balance/);
      assert.equal(await snapshot(f), before);
    });
    await t.test('3 real server failure after debit rolls back wallet/history/expiry writes', async () => {
      const f = await seed(); const before = await snapshot(f); await fail('findAndModify');
      try { await assert.rejects(service.renewWithWallet(request(f)), error => error.code === 2); }
      finally { await clearFailure(); }
      assert.equal(await snapshot(f), before);
    });
    await t.test('4 concurrent requests for the same entitlement/key never double-charge or extend twice', async () => {
      for (let i = 0; i < 3; i++) {
        const f = await seed();
        const outcomes = await Promise.allSettled([service.renewWithWallet(request(f)), service.renewWithWallet(request(f))]);
        assert.ok(outcomes.some(row => row.status === 'fulfilled'));
        console.log('[CONCURRENCY]', outcomes.map(row => row.status === 'fulfilled' ? `fulfilled/replay=${row.value.alreadyProcessed}` : `rejected/code=${row.reason.code}`).join(', '));
        await assertOneRenewal(f);
        assert.equal(await Renewal.countDocuments({ userId: f.owner._id }), 1);
      }
    });
    await t.test('5 cross-entitlement key reuse returns domain conflict with no mutation', async () => {
      const f = await seed(150000, 2); await service.renewWithWallet(request(f)); const before = await snapshot(f);
      await assert.rejects(service.renewWithWallet(request(f, f.entitlements[1])), { code: 'RENEWAL_ENTITLEMENT_MISMATCH', statusCode: 409 });
      assert.equal(await snapshot(f), before);
    });
    await t.test('6 valid Paid replay returns original record with no writes or notifications', async () => {
      const f = await seed(); const original = await service.renewWithWallet(request(f)); const before = await snapshot(f);
      const replay = await service.renewWithWallet(request(f));
      assert.equal(replay.alreadyProcessed, true); assert.equal(String(replay.renewalId), String(original.renewalId));
      assert.equal(replay.newExpireAt.toISOString(), original.newExpireAt.toISOString());
      assert.equal(await snapshot(f), before);
    });
    await t.test('7 notification SUCCESS persists once; post-commit insert failure retries without another debit', async () => {
      const f = await seed(); const realNotify = notifications.notifyRenewal;
      // Fault injection only: all MongoDB methods and transactions remain real.
      notifications.notifyRenewal = async (...args) => { await fail('insert'); return realNotify(...args); };
      try { assert.equal((await service.renewWithWallet(request(f))).status, 'paid'); }
      finally { notifications.notifyRenewal = realNotify; await clearFailure(); }
      await assertOneRenewal(f);
      assert.equal((await Renewal.findOne({ userId: f.owner._id })).notificationPending, true);
      assert.equal(await Inbox.countDocuments({ userId: f.owner._id }), 0);
      assert.equal(await Notification.countDocuments({ targetUsers: f.owner._id }), 0);
      await service.renewWithWallet(request(f)); await notifications.retryPending(null); await notifications.retryPending(null);
      await assertOneRenewal(f);
      const renewal = await Renewal.findOne({ userId: f.owner._id }); assert.equal(renewal.notificationPending, false);
      const notices = await Notification.find({ targetUsers: f.owner._id }); assert.equal(notices.length, 1);
      assert.equal(notices[0].priority, 'SUCCESS'); assert.equal(notices[0].metadata.renewalId, String(renewal._id));
      assert.equal(notices[0].metadata.entitlementId, String(f.entitlements[0]._id));
      assert.equal(await Inbox.countDocuments({ userId: f.owner._id, notificationId: notices[0]._id }), 1);
      assert.equal(await EventLog.countDocuments({ eventType: notices[0].metadata.eventType, referenceId: notices[0].metadata.referenceId }), 1);
    });
  } finally {
    if (connected) await mongoose.disconnect();
    if (replica) await replica.stop({ doCleanup: true, force: true });
  }
});
