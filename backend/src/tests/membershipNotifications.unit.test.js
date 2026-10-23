const test = require('node:test');
const assert = require('node:assert/strict');
const service = require('../services/membershipNotifications');
const notificationService = require('../services/notificationService');
const Entitlement = require('../models/MembershipSlotEntitlement');
const Renewal = require('../models/MembershipEntitlementRenewal');
const Subscription = require('../models/Subscription');
const EventLog = require('../models/NotificationEventLog');
const Notification = require('../models/Notification');
const Inbox = require('../models/UserNotification');

const id = '507f1f77bcf86cd799439012';
const userId = '507f1f77bcf86cd799439011';
const subscriptionId = '507f1f77bcf86cd799439013';

test('actual membership producers emit typed in-app metadata and deduplicate by owner/event/expiry cycle', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2030-01-01T00:00:00Z') });
  const originalPopulate = [Entitlement.populate, Subscription.populate];
  Entitlement.populate = Subscription.populate = async (entity) => entity;
  const original = notificationService.createAutoNotification;
  const calls = [];
  const seen = new Set();
  notificationService.createAutoNotification = async (...args) => {
    calls.push(args);
    const key = `${args[0]}:${args[1]}`;
    if (seen.has(key)) return null;
    seen.add(key);
    return { _id: id, ...args[4] };
  };
  try {
    const entity = { _id: id, ownerId: userId, sourceSubscriptionId: subscriptionId, slotCode: 'M1', floorId: { name: 'Floor B1' }, expireAt: new Date('2030-01-03'), packageId: { name: 'Premium Monthly' } };
    assert.equal(await service.notifyExpiry(null, entity), true);
    await service.notifyExpiry(null, entity);
    assert.equal(seen.size, 1);
    const [eventType, reference, recipient, template, metadata] = calls[0];
    assert.equal(eventType, 'MEMBERSHIP_ENTITLEMENT_EXPIRING_SOON');
    assert.equal(template, eventType);
    assert.equal(recipient, userId);
    assert.match(reference, /2030-01-03/);
    assert.equal(metadata.entitlementId, id);
    assert.equal(metadata.subscriptionId, subscriptionId);
    assert.equal(metadata.deepLink, `/customer/membership-transfers?entitlementId=${id}`);
    assert.equal(metadata.floorName, 'Floor B1');
    assert.equal(metadata.packageName, 'Premium Monthly');
    assert.equal(calls[0][5].atomicMembership, true);
    await service.notifyExpiry(null, { ...entity, expireAt: new Date('2029-12-31') }, true);
    await service.notifyExpiry(null, { ...entity, expireAt: new Date('2030-01-04') });
    await service.notifyExpiry(null, { ...entity, ownerId: subscriptionId });
    assert.equal(seen.size, 4);
    await service.notifyExpiry(null, { _id: subscriptionId, user: userId, expireAt: entity.expireAt }, false, 'subscription');
    assert.equal(calls.at(-1)[0], 'VIP_EXPIRING_SOON');
    assert.equal(calls.at(-1)[4].deepLink, `/customer/membership-transfers?subscriptionId=${subscriptionId}`);
  } finally { notificationService.createAutoNotification = original; [Entitlement.populate, Subscription.populate] = originalPopulate; }
});

test('renewal success requires committed paid marker, retries failures, and never sends transaction data to new owner', async () => {
  const originals = [notificationService.createAutoNotification, Entitlement.findOne, Renewal.updateOne];
  const calls = [];
  let currentOwner = true;
  let fail = true;
  notificationService.createAutoNotification = async (...args) => { calls.push(args); if (fail) throw new Error('fixture delivery failure'); return { _id: id }; };
  Entitlement.findOne = (filter) => { assert.deepEqual(filter, { _id: id, ownerId: userId }); return { select: async () => currentOwner ? { slotCode: 'A01' } : null }; };
  let processed = 0;
  Renewal.updateOne = async () => { processed += 1; };
  const renewal = { _id: subscriptionId, entitlementId: id, sourceSubscriptionId: subscriptionId, userId, status: 'paid', notificationPending: true, oldExpireAt: new Date('2030-01-03'), newExpireAt: new Date('2030-02-03'), amount: 100000, packageSnapshot: { name: 'Monthly' } };
  try {
    assert.equal(await service.notifyRenewal({ ...renewal, status: 'pending' }), false);
    assert.equal(await service.notifyRenewal({ ...renewal, status: 'failed' }), false);
    assert.equal(calls.length, 0);
    assert.equal(await service.notifyRenewal(renewal), false);
    assert.equal(processed, 0);
    fail = false;
    assert.equal(await service.notifyRenewal(renewal), true);
    assert.equal(processed, 1);
    assert.equal(calls.at(-1)[0], 'MEMBERSHIP_ENTITLEMENT_RENEWAL_SUCCESS');
    assert.equal(calls.at(-1)[4].renewalId, subscriptionId);
    assert.equal(calls.at(-1)[4].amount, 100000);
    currentOwner = false;
    const previous = calls.length;
    await service.notifyRenewal(renewal);
    assert.equal(calls.length, previous);
    assert.equal(processed, 2);
  } finally { [notificationService.createAutoNotification, Entitlement.findOne, Renewal.updateOne] = originals; }
});

test('a prior warning flag is insufficient; valid delivery must match current owner, entitlement and exact expiry cycle', async () => {
  const originals = [EventLog.findOne, Notification.exists, Inbox.exists];
  const entity = { _id: id, ownerId: userId, expireAt: new Date('2026-10-22T13:42:46.553Z'), expireWarningSentAt: new Date() };
  let log = null;
  let notificationExists = false;
  let inboxExists = false;
  let reference;
  EventLog.findOne = (filter) => { reference = filter.referenceId; return { select() { return this; }, lean: async () => log }; };
  Notification.exists = async (filter) => {
    assert.equal(filter.targetUsers, userId);
    assert.equal(filter['metadata.entitlementId'], id);
    assert.equal(filter['metadata.expiryCycle'], entity.expireAt.toISOString());
    assert.equal(filter.priority, 'WARNING');
    return notificationExists;
  };
  Inbox.exists = async (filter) => { assert.equal(filter.userId, userId); assert.equal(Object.hasOwn(filter, 'isRead'), false); assert.equal(Object.hasOwn(filter, 'isDeleted'), false); return inboxExists; };
  try {
    assert.equal(await service.hasValidExpiryNotification(entity), false);
    assert.match(reference, /2026-10-22T13:42:46.553Z/);
    log = { notificationId: subscriptionId };
    assert.equal(await service.hasValidExpiryNotification(entity), false);
    notificationExists = true;
    assert.equal(await service.hasValidExpiryNotification(entity), false, 'missing inbox remains repairable');
    inboxExists = true;
    assert.equal(await service.hasValidExpiryNotification(entity), true);
  } finally { [EventLog.findOne, Notification.exists, Inbox.exists] = originals; }
});
