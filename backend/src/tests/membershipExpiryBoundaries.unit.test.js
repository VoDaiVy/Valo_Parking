const test = require('node:test');
const assert = require('node:assert/strict');
const notifications = require('../services/membershipNotifications');
const delivery = require('../services/membershipNotificationDeliveryService');
const Entitlement = require('../models/MembershipSlotEntitlement');

test('M1 fixture: exact reminder boundary, today before expiry, expiry, renewed cycle and stale snapshot', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-15T02:59:59.999Z') });
  const originals = [Entitlement.populate, Entitlement.updateOne, delivery.deliver];
  const expiry = new Date('2026-10-22T03:00:00Z');
  const row = { _id: '507f1f77bcf86cd799439012', ownerId: '507f1f77bcf86cd799439011', sourceSubscriptionId: '507f1f77bcf86cd799439013', status: 'active', expireAt: expiry, slotCode: 'M1', packageId: { name: 'Premium Monthly' }, floorId: { name: 'Floor B1' } };
  let current = { ...row };
  const emitted = new Map();
  Entitlement.populate = async (entity) => entity;
  Entitlement.updateOne = async (filter) => ({ matchedCount: String(filter.expireAt) === String(current.expireAt) && filter.ownerId === current.ownerId && (filter.status?.$in ? filter.status.$in.includes(current.status) : filter.status === current.status) ? 1 : 0 });
  delivery.deliver = async (event, ref, userId, data, guard) => {
    if (!await guard({ fixture: true }) || emitted.has(ref)) return null;
    emitted.set(ref, data);
    return { _id: 'fixture', ...data };
  };
  try {
    assert.equal(await notifications.notifyExpiry(null, row), false, 'one millisecond before reminder window');
    assert.equal(emitted.size, 0);
    t.mock.timers.setTime(new Date('2026-10-15T03:00:00Z').getTime());
    assert.equal(await notifications.notifyExpiry(null, row), true, 'exactly 7 days before expiry');
    assert.equal(emitted.size, 1);
    const reminder = [...emitted.values()][0];
    assert.equal(reminder.priority, 'WARNING');
    assert.match(reminder.content, /Premium Monthly - space M1, Floor B1 expires on 22 Oct 2026, 10:00:00/);
    assert.equal(reminder.metadata.entitlementId, row._id);
    assert.equal(reminder.metadata.expiryCycle, expiry.toISOString());
    await notifications.notifyExpiry(null, row);
    assert.equal(emitted.size, 1, 'scheduler replay deduplicates');
    t.mock.timers.setTime(new Date('2026-10-21T18:00:00Z').getTime());
    assert.equal(await notifications.notifyExpiry(null, row, true), false, 'today is not expired before its instant');
    await notifications.notifyExpiry(null, row);
    assert.equal(emitted.size, 1);
    current = { ...row, expireAt: new Date('2026-11-22T03:00:00Z') };
    await notifications.notifyExpiry(null, row);
    assert.equal(emitted.size, 1, 'a pre-renewal scheduler snapshot cannot notify old expiry');
    t.mock.timers.setTime(new Date('2026-11-15T03:00:00Z').getTime());
    await notifications.notifyExpiry(null, current);
    assert.equal(emitted.size, 2, 'new expiry cycle remains eligible');
    t.mock.timers.setTime(new Date('2026-11-22T03:00:00Z').getTime());
    assert.equal(await notifications.notifyExpiry(null, current), false, 'at expiry never send remaining-time reminder');
    current = { ...current, status: 'expired' };
    await notifications.notifyExpiry(null, current, true);
    await notifications.notifyExpiry(null, current, true);
    assert.equal(emitted.size, 3);
    const expired = [...emitted.values()].at(-1);
    assert.equal(expired.priority, 'WARNING');
    assert.match(expired.content, /expired on/);
    assert.doesNotMatch(expired.content, /expires on/);
  } finally { [Entitlement.populate, Entitlement.updateOne, delivery.deliver] = originals; }
});

test('multiple spaces are evaluated independently at the same scheduler time', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-22T03:00:00Z') });
  const originals = [Entitlement.populate, Entitlement.updateOne, delivery.deliver];
  Entitlement.populate = async (entity) => entity;
  Entitlement.updateOne = async () => ({ matchedCount: 1 });
  const rows = [];
  delivery.deliver = async (event, ref, user, data, guard) => { if (await guard({})) rows.push(data); return null; };
  const entity = { ownerId: '507f1f77bcf86cd799439011', status: 'active', packageId: { name: 'Premium Monthly' }, floorId: { name: 'Floor B1' } };
  try {
    await notifications.notifyExpiry(null, { ...entity, _id: '507f1f77bcf86cd799439012', status: 'expired', slotCode: 'M1', expireAt: new Date('2026-10-22T03:00:00Z') }, true);
    await notifications.notifyExpiry(null, { ...entity, _id: '507f1f77bcf86cd799439013', slotCode: 'M2', expireAt: new Date('2026-10-23T03:00:00Z') });
    await notifications.notifyExpiry(null, { ...entity, _id: '507f1f77bcf86cd799439014', slotCode: 'M3', expireAt: new Date('2026-11-23T03:00:00Z') });
    assert.deepEqual(rows.map((row) => [row.metadata.entitlementId, row.metadata.eventType, row.priority]), [
      ['507f1f77bcf86cd799439012', 'MEMBERSHIP_ENTITLEMENT_EXPIRED', 'WARNING'],
      ['507f1f77bcf86cd799439013', 'MEMBERSHIP_ENTITLEMENT_EXPIRING_SOON', 'WARNING'],
    ]);
  } finally { [Entitlement.populate, Entitlement.updateOne, delivery.deliver] = originals; }
});

test('transfer rejects old-owner snapshot and permits exactly one reminder for the new current owner/cycle', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-15T13:42:46.553Z') });
  const originals = [Entitlement.populate, Entitlement.updateOne, delivery.deliver];
  const oldOwner = '507f1f77bcf86cd799439011';
  const newOwner = '507f1f77bcf86cd799439014';
  const row = { _id: '507f1f77bcf86cd799439012', ownerId: oldOwner, status: 'active', slotCode: 'B1', expireAt: new Date('2026-10-22T13:42:46.553Z'), packageId: { name: 'Premium Monthly', renewalWindowDays: 7 }, floorId: { name: 'Basement 1' } };
  let currentOwner = oldOwner;
  const recipients = [];
  const seen = new Set();
  Entitlement.populate = async (entity) => entity;
  Entitlement.updateOne = async (filter) => ({ matchedCount: filter.ownerId === currentOwner ? 1 : 0 });
  delivery.deliver = async (event, reference, user, data, guard) => {
    if (!await guard({}) || seen.has(reference)) return null;
    seen.add(reference); recipients.push(user); return { _id: 'fixture', ...data };
  };
  try {
    await notifications.notifyExpiry(null, row);
    currentOwner = newOwner;
    await notifications.notifyExpiry(null, row);
    await notifications.notifyExpiry(null, { ...row, ownerId: newOwner });
    await notifications.notifyExpiry(null, { ...row, ownerId: newOwner });
    assert.deepEqual(recipients, [oldOwner, newOwner]);
    assert.equal(seen.size, 2);
  } finally { [Entitlement.populate, Entitlement.updateOne, delivery.deliver] = originals; }
});
