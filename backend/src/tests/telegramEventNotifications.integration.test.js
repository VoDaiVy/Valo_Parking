const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const User = require('../models/User');
const Detail = require('../models/UserDetail');
const Link = require('../models/TelegramLink');
const Delivery = require('../models/TelegramEventDelivery');
const LegacyDelivery = require('../models/TelegramDelivery');
const Subscription = require('../models/Subscription');
const Voucher = require('../models/UserVoucher');
const Violation = require('../models/Violation');
const Entitlement = require('../models/MembershipSlotEntitlement');
const Package = require('../models/TicketPackage');
const Floor = require('../models/ParkingFloor');
const Vehicle = require('../models/Vehicle');
const client = require('../services/telegramClient');
const qr = require('../services/membershipQrService');

let repl, service, user, link, calls;
const originalEnv = { ...process.env };
const originalSendMessage = client.sendMessage;
const originalSendPhoto = client.sendPhoto;
const id = () => new mongoose.Types.ObjectId();
const future = () => new Date(Date.now() + 86400000);
before(async () => {
  repl = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(repl.getUri('telegram_event_notifications_test'));
  assert.equal(mongoose.connection.host, '127.0.0.1');
  service = require('../services/telegramEventNotificationService');
  await Promise.all(Object.values(mongoose.models).map(Model => Model.init()));
});
beforeEach(async () => {
  for (const Model of Object.values(mongoose.models)) await Model.deleteMany({});
  process.env.TELEGRAM_ENABLED = 'true';
  process.env.TELEGRAM_EVENTS_FROM = new Date(Date.now() - 3600000).toISOString();
  process.env.TELEGRAM_WEB_APP_URL = 'https://parking.example.com';
  process.env.MEMBERSHIP_QR_SECRET = 'local-test-only-secret';
  calls = [];
  client.sendMessage = async (...args) => { calls.push({ method: 'message', args }); return { message_id: 42 }; };
  client.sendPhoto = async (...args) => { calls.push({ method: 'photo', args }); return { message_id: 43 }; };
  user = await User.create({ username: 'telegramcustomer', email: 'telegram@example.com', role: 'customer', status: true });
  await Detail.create({ userId: user._id, phone: '0901234567' });
  link = await Link.create({ userId: user._id, telegramUserId: '123456', chatId: '123456', phone: '0901234567', linkedAt: new Date(Date.now() - 60000) });
});
after(async () => {
  client.sendMessage = originalSendMessage;
  client.sendPhoto = originalSendPhoto;
  for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
  Object.assign(process.env, originalEnv);
  await mongoose.disconnect();
  if (repl) await repl.stop();
});

async function voucher(overrides = {}) {
  return Voucher.create({ userId: user._id, source: 'spending',
    benefitSnapshot: { name: 'Ưu đãi mới', type: 'FIXED_DISCOUNT', discountAmount: 50000, minimumAmount: 100000, pointCost: 0 },
    expiresAt: future(), ...overrides });
}
async function violation(overrides = {}) {
  const vehicle = await Vehicle.create({ owner: user._id, licensePlate: '43A12345', vehicleType: 'car', brand: 'Test' });
  return Violation.create({ userId: user._id, vehicleId: vehicle._id, title: 'Đỗ sai vị trí', description: 'Vui lòng di chuyển xe', fineAmount: 50000, createdBy: id(), ...overrides });
}
async function subscription(overrides = {}) {
  const pkg = await Package.create({ name: 'Gói tháng', type: 'monthly', price: 500000 });
  return Subscription.create({ user: user._id, ticketPackage: pkg._id, slots: [], amount: 500000,
    orderCode: 123456, expireAt: future(), status: 'active', paymentStatus: 'paid', ...overrides });
}
async function queued(kind) {
  await service.reconcile();
  const record = await Delivery.findOne({ kind });
  assert.ok(record, `expected a ${kind} delivery`);
  record.status = 'processing'; record.leaseId = 'test-lease'; record.leaseUntil = new Date(Date.now() + 60000);
  await record.save();
  return record;
}

test('new voucher event is persisted with its business record and a transaction rollback leaves neither', async () => {
  const session = await mongoose.startSession();
  session.startTransaction();
  const [record] = await Voucher.create([{ userId: user._id, source: 'spending', benefitSnapshot: { name: 'Rolled back', type: 'FIXED_DISCOUNT', discountAmount: 10000, pointCost: 0 }, expiresAt: future() }], { session });
  assert.ok(record.telegramNotification.occurredAt instanceof Date);
  await session.abortTransaction();
  await session.endSession();
  await service.reconcile();
  assert.equal(await Voucher.countDocuments(), 0);
  assert.equal(await Delivery.countDocuments(), 0);
});

test('paid activation records one event while pending subscriptions have no event and renewals preserve its identity', async () => {
  const record = await subscription({ status: 'pending', paymentStatus: 'pending' });
  assert.equal(record.telegramNotification, undefined);
  record.paymentStatus = 'paid'; record.status = 'active';
  await record.save();
  const occurredAt = record.telegramNotification.occurredAt.getTime();
  record.expireAt = new Date(Date.now() + 2 * 86400000);
  await record.save();
  assert.equal(record.telegramNotification.occurredAt.getTime(), occurredAt);
});

test('opted-in repair records a missing purchase event while renewal and historical activation never do', async () => {
  const { activateSubscriptionEntitlements } = require('../services/membershipEntitlementService');
  const repaired = await subscription({ status: 'failed' });
  await Subscription.updateOne({ _id: repaired._id }, { $unset: { telegramNotification: 1 } });
  const loaded = await Subscription.findById(repaired._id);
  loaded.status = 'active';
  await loaded.save();
  assert.equal(loaded.telegramNotification, undefined);
  await activateSubscriptionEntitlements(loaded, { recordPurchaseEvent: true });
  const event = (await Subscription.findById(repaired._id)).telegramNotification;
  assert.ok(event.occurredAt instanceof Date);
  await activateSubscriptionEntitlements(loaded, { recordPurchaseEvent: true });
  assert.equal((await Subscription.findById(repaired._id)).telegramNotification.occurredAt.getTime(), event.occurredAt.getTime());

  const renewal = await subscription();
  await Subscription.updateOne({ _id: renewal._id }, { $unset: { telegramNotification: 1 } });
  await activateSubscriptionEntitlements(await Subscription.findById(renewal._id));
  assert.equal((await Subscription.findById(renewal._id)).telegramNotification, undefined);

  const historical = await subscription();
  await Subscription.collection.updateOne({ _id: historical._id }, { $unset: { telegramNotification: 1 }, $set: { createdAt: new Date('2020-01-01') } });
  await activateSubscriptionEntitlements(await Subscription.findById(historical._id), { recordPurchaseEvent: true });
  assert.equal((await Subscription.findById(historical._id)).telegramNotification, undefined);
});

test('repair activation and its purchase event roll back together when the transaction fails', async () => {
  const { activateSubscriptionEntitlements } = require('../services/membershipEntitlementService');
  const record = await subscription({ status: 'failed' });
  await Subscription.updateOne({ _id: record._id }, { $unset: { telegramNotification: 1 } });
  const originalUser = await User.findById(user._id).lean();
  const session = await mongoose.startSession();
  try {
    await assert.rejects(session.withTransaction(async () => {
      const repairing = await Subscription.findById(record._id).session(session);
      repairing.status = 'active';
      await repairing.save({ session });
      await activateSubscriptionEntitlements(repairing, { session, recordPurchaseEvent: true });
      const inside = await Subscription.findById(record._id).session(session);
      assert.equal(inside.status, 'active');
      assert.ok(inside.telegramNotification.occurredAt);
      throw new Error('simulate repair interruption before commit');
    }), /simulate repair interruption/);
  } finally { await session.endSession(); }
  const afterRollback = await Subscription.findById(record._id);
  assert.equal(afterRollback.status, 'failed');
  assert.equal(afterRollback.telegramNotification, undefined);
  assert.equal((await User.findById(user._id)).membership.qrVersion, originalUser.membership.qrVersion);
  await service.reconcile();
  assert.equal(await Delivery.countDocuments(), 0);
});

test('voucher enqueue survives replays and the source marker prevents replay after delivery TTL removal', async () => {
  const record = await voucher();
  const job = await queued('voucher_received');
  assert.equal(String(job.eventUserId), String(user._id));
  assert.equal(String(job.voucherId), String(record._id));
  await service.reconcile();
  assert.equal(await Delivery.countDocuments(), 1);
  assert.ok((await Voucher.findById(record._id)).telegramNotification.processedAt);
  await Delivery.deleteMany({});
  await service.reconcile();
  assert.equal(await Delivery.countDocuments(), 0);
});

test('missing account link is skipped permanently instead of replayed when a user links later', async () => {
  await Link.deleteMany({});
  const record = await voucher();
  await service.reconcile();
  assert.equal(await Delivery.countDocuments(), 0);
  assert.ok((await Voucher.findById(record._id)).telegramNotification.processedAt);
  await Link.create({ userId: user._id, telegramUserId: 'new', chatId: 'new', phone: '0901234567' });
  await service.reconcile();
  assert.equal(await Delivery.countDocuments(), 0);
});

test('an account linked after the event cannot receive its historical voucher', async () => {
  const record = await voucher();
  await Link.updateOne({ _id: link._id }, { $set: { linkedAt: new Date(record.telegramNotification.occurredAt.getTime() + 1000) } });
  await service.reconcile();
  assert.equal(await Delivery.countDocuments(), 0);
});

test('rollout excludes old business events and records without an explicit outbox marker', async () => {
  const record = await voucher();
  await Voucher.updateOne({ _id: record._id }, { $set: { 'telegramNotification.occurredAt': new Date('2020-01-01') } });
  await Voucher.collection.insertOne({ userId: user._id, status: 'available', expiresAt: future(), source: 'spending' });
  await service.reconcile();
  assert.equal(await Delivery.countDocuments(), 0);
});

test('missing rollout cutoff and disabled Telegram do not send or queue events', async () => {
  await voucher();
  delete process.env.TELEGRAM_EVENTS_FROM;
  await service.reconcile();
  assert.equal(await Delivery.countDocuments(), 0);
  process.env.TELEGRAM_EVENTS_FROM = new Date(Date.now() - 3600000).toISOString();
  process.env.TELEGRAM_ENABLED = 'false';
  await service.reconcile();
  assert.equal(await Delivery.countDocuments(), 0);
});

test('voucher delivery sends the current benefit to the linked user without a fabricated redeem code', async () => {
  await voucher();
  const job = await queued('voucher_received');
  const result = await service.processDelivery(job);
  assert.equal(result.status, 'sent');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'message');
  assert.equal(calls[0].args[0], link.chatId);
  assert.match(calls[0].args[1], /50[.,]000/);
  assert.match(calls[0].args[1], /100[.,]000/);
  assert.match(JSON.stringify(calls[0].args), /customer\/rewards/);
});

test('used and revoked vouchers are cancelled before any Telegram side effect', async () => {
  const record = await voucher();
  const job = await queued('voucher_received');
  for (const status of ['used', 'revoked', 'expired']) {
    await Voucher.updateOne({ _id: record._id }, { $set: { status } });
    assert.equal((await service.processDelivery(job)).status, 'cancelled');
  }
  assert.equal(calls.length, 0);
});

test('revoking or relinking an account cancels queued personal information', async () => {
  await voucher();
  const job = await queued('voucher_received');
  await Link.updateOne({ _id: link._id }, { $set: { revokedAt: new Date() } });
  assert.equal((await service.processDelivery(job)).status, 'cancelled');
  await Link.updateOne({ _id: link._id }, { $set: { revokedAt: null, linkedAt: new Date(Date.now() + 1000) } });
  assert.equal((await service.processDelivery(job)).status, 'cancelled');
  assert.equal(calls.length, 0);
});

test('profile phone changes, disabled notifications and a forged user identity cannot receive the job', async () => {
  await voucher();
  const job = await queued('voucher_received');
  await Detail.updateOne({ userId: user._id }, { $set: { phone: '0912345678' } });
  assert.equal((await service.processDelivery(job)).status, 'cancelled');
  await Detail.updateOne({ userId: user._id }, { $set: { phone: '0901234567' } });
  await Link.updateOne({ _id: link._id }, { $set: { notificationsEnabled: false } });
  assert.equal((await service.processDelivery(job)).status, 'cancelled');
  await Link.updateOne({ _id: link._id }, { $set: { notificationsEnabled: true } });
  job.eventUserId = id();
  assert.equal((await service.processDelivery(job)).status, 'cancelled');
  assert.equal(calls.length, 0);
});

test('confirmed violation sends its plate and amount; cancelled or paid violations never send stale demands', async () => {
  const record = await violation();
  assert.ok(record.telegramNotification.occurredAt);
  const job = await queued('violation_created');
  assert.equal((await service.processDelivery(job)).status, 'sent');
  assert.match(calls[0].args[1], /43A12345/);
  assert.match(calls[0].args[1], /50[.,]000/);
  calls.length = 0;
  for (const status of ['CANCELLED', 'PAID']) {
    await Violation.updateOne({ _id: record._id }, { $set: { status } });
    assert.equal((await service.processDelivery(job)).status, 'cancelled');
  }
  assert.equal(calls.length, 0);
});

test('active legacy membership sends a real QR PNG and the signed credential used by the application', async (t) => {
  const record = await subscription();
  const job = await queued('membership_activated');
  const qrcode = require('qrcode');
  const original = qrcode.toBuffer;
  let encoded;
  qrcode.toBuffer = async (...args) => { encoded = args[0]; return original(...args); };
  t.after(() => { qrcode.toBuffer = original; });
  assert.equal((await service.processDelivery(job)).status, 'sent');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'photo');
  assert.equal(calls[0].args[0], link.chatId);
  assert.ok(Buffer.isBuffer(calls[0].args[1]));
  assert.equal(calls[0].args[1].subarray(1, 4).toString(), 'PNG');
  assert.match(calls[0].args[2], /Gói tháng/);
  assert.equal(encoded, qr.buildMembershipQrPayload(record));
  assert.equal(qr.parseAndVerifyAnyMembershipQr(encoded).subscriptionId, String(record._id));
});

test('a transferred membership cannot send the former owner an account membership QR', async () => {
  const record = await subscription();
  const floor = await Floor.create({ floorNumber: 1, name: 'Tầng 1' });
  await Entitlement.create({ ownerId: user._id, sourceSubscriptionId: record._id, slotId: id(), floorId: floor._id,
    slotCode: 'A01', packageId: record.ticketPackage, validFrom: new Date(Date.now() - 1000), expireAt: future(), status: 'active', unitAmount: 500000 });
  const job = await queued('membership_activated');
  await Entitlement.updateMany({ sourceSubscriptionId: record._id }, { $set: { ownerId: id(), status: 'transferred' } });
  assert.equal((await service.processDelivery(job)).status, 'cancelled');
  assert.equal(calls.length, 0);
});

test('a legacy subscription uses the account QR when the application would show an unrelated active entitlement', async (t) => {
  const record = await subscription();
  const floor = await Floor.create({ floorNumber: 1, name: 'Tầng 1' });
  await Entitlement.create({ ownerId: user._id, sourceSubscriptionId: id(), slotId: id(), floorId: floor._id,
    slotCode: 'A01', packageId: record.ticketPackage, validFrom: new Date(Date.now() - 1000), expireAt: future(), status: 'active', unitAmount: 500000 });
  const job = await queued('membership_activated');
  const qrcode = require('qrcode');
  const original = qrcode.toBuffer;
  let encoded;
  qrcode.toBuffer = async (...args) => { encoded = args[0]; return original(...args); };
  t.after(() => { qrcode.toBuffer = original; });
  assert.equal((await service.processDelivery(job)).status, 'sent');
  assert.equal(encoded, qr.buildAccountMembershipQrPayload(user));
  assert.equal(qr.parseAndVerifyAnyMembershipQr(encoded).credentialType, 'ACCOUNT');
});

test('QR rotation during image rendering cancels the outdated account credential', async (t) => {
  const record = await subscription();
  const floor = await Floor.create({ floorNumber: 1, name: 'Tầng 1' });
  await Entitlement.create({ ownerId: user._id, sourceSubscriptionId: record._id, slotId: id(), floorId: floor._id,
    slotCode: 'A01', packageId: record.ticketPackage, validFrom: new Date(Date.now() - 1000), expireAt: future(), status: 'active', unitAmount: 500000 });
  const job = await queued('membership_activated');
  const qrcode = require('qrcode');
  const original = qrcode.toBuffer;
  qrcode.toBuffer = async (...args) => {
    const png = await original(...args);
    await User.updateOne({ _id: user._id }, { $inc: { 'membership.qrVersion': 1 } });
    return png;
  };
  t.after(() => { qrcode.toBuffer = original; });
  assert.equal((await service.processDelivery(job)).status, 'cancelled');
  assert.equal(calls.length, 0);
});

test('malformed rollout cutoffs do not queue; disabling an event kind cancels its pending delivery', async () => {
  await voucher();
  process.env.TELEGRAM_EVENTS_FROM = 'not-a-date';
  await service.reconcile();
  assert.equal(await Delivery.countDocuments(), 0);
  process.env.TELEGRAM_EVENTS_FROM = new Date(Date.now() - 3600000).toISOString();
  const job = await queued('voucher_received');
  process.env.TELEGRAM_VOUCHER_RECEIVED_ENABLED = 'false';
  try {
    assert.equal((await service.processDelivery(job)).status, 'cancelled');
    assert.equal(calls.length, 0);
  } finally { delete process.env.TELEGRAM_VOUCHER_RECEIVED_ENABLED; }
});

test('worker sends new voucher events without treating them as ParkingPass tickets', async () => {
  await voucher();
  await service.reconcile();
  await require('../services/telegramWorker').runTelegramWorkerOnce();
  const job = await Delivery.findOne({ kind: 'voucher_received' });
  assert.equal(job.status, 'sent');
  assert.equal(job.messageId, 42);
  assert.equal(calls.length, 1);
});

test('worker retains uncertainty after a send timeout and never automatically repeats the event', async () => {
  await voucher();
  await service.reconcile();
  client.sendMessage = async () => { calls.push({ method: 'timeout' }); throw Object.assign(new Error('Timed out after network write'), { code: 'ETIMEDOUT' }); };
  const worker = require('../services/telegramWorker');
  await worker.runTelegramWorkerOnce();
  let job = await Delivery.findOne({ kind: 'voucher_received' });
  assert.equal(job.status, 'uncertain');
  await Delivery.updateOne({ _id: job._id }, { $set: { nextAttemptAt: new Date(0) } });
  await worker.runTelegramWorkerOnce();
  job = await Delivery.findById(job._id);
  assert.equal(job.status, 'uncertain');
  assert.equal(calls.length, 1);
});

test('worker does not resend a new event whose sender crashed with an expired lease', async () => {
  await voucher();
  const job = await queued('voucher_received');
  await Delivery.updateOne({ _id: job._id }, { $set: { leaseUntil: new Date(0) } });
  await require('../services/telegramWorker').runTelegramWorkerOnce();
  assert.equal((await Delivery.findById(job._id)).status, 'uncertain');
  assert.equal(calls.length, 0);
});

test('worker obeys Telegram rate limiting and marks blocked recipients without losing business records', async () => {
  const record = await voucher();
  await service.reconcile();
  client.sendMessage = async () => { throw Object.assign(new Error('Rate limited'), { response: { status: 429, data: { error_code: 429, parameters: { retry_after: 60 } } } }); };
  const worker = require('../services/telegramWorker');
  const started = Date.now();
  await worker.runTelegramWorkerOnce();
  let job = await Delivery.findOne({ kind: 'voucher_received' });
  assert.equal(job.status, 'pending');
  assert.equal(job.errorCode, 'RATE_LIMIT');
  assert.ok(job.nextAttemptAt.getTime() >= started + 60000);
  client.sendMessage = async () => { throw Object.assign(new Error('Blocked'), { response: { status: 403, data: { error_code: 403 } } }); };
  await Delivery.updateOne({ _id: job._id }, { $set: { nextAttemptAt: new Date(0) } });
  await worker.runTelegramWorkerOnce();
  job = await Delivery.findById(job._id);
  assert.equal(job.status, 'failed');
  assert.ok((await Link.findById(link._id)).blockedAt);
  assert.equal((await Voucher.findById(record._id)).status, 'available');
});

test('an older worker polling the ticket collection cannot lease isolated event jobs', async () => {
  await voucher();
  await service.reconcile();
  assert.notEqual(Delivery.collection.collectionName, LegacyDelivery.collection.collectionName);
  assert.equal(await Delivery.countDocuments({ kind: 'voucher_received', status: 'pending' }), 1);
  const worker = require('../services/telegramWorker');
  // This reproduces the legacy worker's broad pending/uncertain acquisition.
  assert.equal(await worker.acquireLease(LegacyDelivery, ['pending', 'uncertain']), null);
  await worker.runTelegramWorkerOnce();
  assert.equal((await Delivery.findOne({ kind: 'voucher_received' })).status, 'sent');
  assert.equal(calls.length, 1);
});

test('account revocation cancels pending ticket and isolated event deliveries together', async () => {
  await voucher();
  await service.reconcile();
  await LegacyDelivery.create({ dedupeKey: 'legacy-booking', kind: 'booking_paid',
    passId: id(), bookingId: id(), linkId: link._id, chatId: link.chatId, telegramUserId: link.telegramUserId });
  await require('../services/telegramProfileService').revokeAccount(user._id);
  assert.equal((await Delivery.findOne({ kind: 'voucher_received' })).status, 'cancelled');
  assert.equal((await LegacyDelivery.findOne({ kind: 'booking_paid' })).status, 'cancelled');
  await require('../services/telegramWorker').runTelegramWorkerOnce();
  assert.equal(calls.length, 0);
});

for (const status of ['sent', 'uncertain']) {
  test(`a ${status} event in the legacy queue prevents a cross-collection repeat`, async () => {
    const record = await voucher();
    await LegacyDelivery.create({
      dedupeKey: `voucher_received:${record._id}`, kind: 'voucher_received', voucherId: record._id,
      eventUserId: user._id, eventOccurredAt: record.telegramNotification.occurredAt,
      linkId: link._id, recipientLinkedAt: link.linkedAt, chatId: link.chatId,
      telegramUserId: link.telegramUserId, status, attempts: 1,
      ...(status === 'sent' ? { sentAt: new Date(), messageId: 100 } : { nextAttemptAt: new Date(0) }),
    });
    await service.reconcile();
    assert.equal(await Delivery.countDocuments({ status: { $in: ['pending', 'processing'] } }), 0);
    await require('../services/telegramWorker').runTelegramWorkerOnce();
    assert.equal(calls.length, 0);
    assert.ok((await Voucher.findById(record._id)).telegramNotification.processedAt);
  });
}
