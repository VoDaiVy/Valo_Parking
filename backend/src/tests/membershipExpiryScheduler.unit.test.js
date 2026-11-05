const test = require('node:test');
const assert = require('node:assert/strict');
const Entitlement = require('../models/MembershipSlotEntitlement');
const Subscription = require('../models/Subscription');
const notifications = require('../services/membershipNotifications');
const { checkVIPSubscriptions } = require('../services/parkingScheduler');

test('VIP scheduler awaits actual in-app pipeline and marks only successful reminders for the same expiry cycle', async () => {
  const originals = [Entitlement.distinct, Entitlement.find, Entitlement.updateOne, Subscription.find, notifications.notifyExpiry, notifications.hasValidExpiryNotification];
  const cycle = new Date(Date.now() + 2 * 86400000);
  const reminder = { _id: '507f1f77bcf86cd799439012', ownerId: '507f1f77bcf86cd799439011', sourceSubscriptionId: '507f1f77bcf86cd799439013', status: 'active', slotCode: 'A01', expireAt: cycle, expireWarningSentAt: new Date() };
  const processed = [];
  const calls = [];
  let deliverySucceeds = false;
  let delivered = false;
  notifications.hasValidExpiryNotification = async () => delivered;
  Entitlement.distinct = async () => [reminder.sourceSubscriptionId];
  Entitlement.find = async (filter) => {
    assert.equal(Object.hasOwn(filter, 'expireWarningSentAt'), false, 'a flag cannot exclude a missing valid inbox delivery');
    return filter.expireAt?.$gt && filter.status?.$in?.includes('active') ? [reminder] : [];
  };
  Subscription.find = async () => [];
  Entitlement.updateOne = async (filter, update) => { processed.push({ filter, update }); };
  notifications.notifyExpiry = async (...args) => { calls.push(args); return deliverySucceeds; };
  try {
    await checkVIPSubscriptions(null);
    assert.equal(calls.length, 1);
    assert.equal(calls[0][1], reminder);
    assert.equal(processed.length, 0, 'failed delivery remains retryable');
    deliverySucceeds = true;
    await checkVIPSubscriptions(null);
    assert.equal(processed.length, 1);
    assert.equal(processed[0].filter.ownerId, reminder.ownerId);
    assert.equal(processed[0].filter.expireAt, cycle, 'cannot mark a later renewed expiry as already warned');
    assert.ok(processed[0].update.$set.expireWarningSentAt instanceof Date);
    delivered = true;
    await checkVIPSubscriptions(null);
    assert.equal(calls.length, 2, 'a valid delivered cycle is not retriggered');
  } finally { [Entitlement.distinct, Entitlement.find, Entitlement.updateOne, Subscription.find, notifications.notifyExpiry, notifications.hasValidExpiryNotification] = originals; }
});
