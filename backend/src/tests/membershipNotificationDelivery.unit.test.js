const test = require('node:test');
const assert = require('node:assert/strict');
const { createMembershipNotificationDelivery } = require('../services/membershipNotificationDeliveryService');

function fixture() {
  let state = { logs: {}, notifications: {}, inbox: {} };
  let failAt = '';
  const query = (get) => ({ session() { return this; }, select() { return this; }, lean: async () => get(), then(resolve, reject) { return Promise.resolve(get()).then(resolve, reject); } });
  const key = (filter) => `${filter.eventType}:${filter.referenceId}`;
  const session = { async withTransaction(callback) { const previous = structuredClone(state); try { await callback(); } catch (err) { state = previous; throw err; } }, async endSession() {} };
  const service = createMembershipNotificationDelivery({
    startSession: async () => session,
    User: { findOne: () => query(() => ({ _id: 'user' })) },
    Log: {
      findOne: (filter) => query(() => state.logs[key(filter)] || null),
      updateOne: async (filter, update, options) => { assert.equal(options.session, session); if (failAt === 'log') throw new Error('crash before log commit'); state.logs[key(filter)] = { ...filter, ...update.$set }; },
    },
    Notification: {
      findOne: (filter) => query(() => Object.values(state.notifications).find((n) => n.metadata.referenceId === filter['metadata.referenceId']) || null),
      create: async ([data], options) => { assert.equal(options.session, session); const row = { _id: `n${Object.keys(state.notifications).length + 1}`, ...data }; state.notifications[row._id] = row; return [row]; },
    },
    Inbox: { updateOne: async (filter, update, options) => { assert.equal(options.session, session); if (failAt === 'inbox') throw new Error('crash before inbox'); state.inbox[filter.notificationId] ||= update.$setOnInsert; } },
  });
  return { service, session, state: () => state, fail: (at) => { failAt = at; } };
}
const event = 'MEMBERSHIP_ENTITLEMENT_EXPIRING_SOON';
const data = (ref) => ({ title: 'Reminder', content: 'Premium Monthly - M1 / Floor B1', type: 'SYSTEM', priority: 'WARNING', metadata: { eventType: event, referenceId: ref } });

test('failure before inbox or log commit rolls back all writes and retry delivers exactly once', async () => {
  for (const stage of ['inbox', 'log']) {
    const f = fixture(); f.fail(stage);
    await assert.rejects(f.service.deliver(event, 'M1:cycle1', 'user', data('M1:cycle1')), /crash/);
    assert.deepEqual(f.state(), { logs: {}, notifications: {}, inbox: {} });
    f.fail('');
    await f.service.deliver(event, 'M1:cycle1', 'user', data('M1:cycle1'));
    assert.equal(await f.service.deliver(event, 'M1:cycle1', 'user', data('M1:cycle1')), null);
    assert.equal(Object.keys(f.state().inbox).length, 1);
    await f.service.deliver(event, 'M1:cycle2', 'user', data('M1:cycle2'));
    await f.service.deliver(event, 'M2:cycle1', 'user', data('M2:cycle1'));
    assert.equal(Object.keys(f.state().inbox).length, 3);
  }
});

test('legacy orphan log recovers on retry; existing inbox read state is preserved', async () => {
  const f = fixture();
  f.state().logs[`${event}:M1:cycle1`] = { eventType: event, referenceId: 'M1:cycle1', notificationId: null };
  f.state().notifications.old = { _id: 'old', ...data('M1:cycle1') };
  f.state().inbox.old = { isRead: true, isDeleted: true };
  await f.service.deliver(event, 'M1:cycle1', 'user', data('M1:cycle1'));
  assert.equal(Object.keys(f.state().notifications).length, 1);
  assert.equal(f.state().logs[`${event}:M1:cycle1`].notificationId, 'old');
  assert.deepEqual(f.state().inbox.old, { isRead: true, isDeleted: true });
});

test('legacy crash after log claim but before notification/inbox is recoverable', async () => {
  const f = fixture();
  f.state().logs[`${event}:M1:cycle1`] = { eventType: event, referenceId: 'M1:cycle1', notificationId: null };
  await f.service.deliver(event, 'M1:cycle1', 'user', data('M1:cycle1'));
  assert.equal(Object.keys(f.state().notifications).length, 1);
  assert.equal(Object.keys(f.state().inbox).length, 1);
  assert.ok(f.state().logs[`${event}:M1:cycle1`].notificationId);
});

test('completed log with missing inbox repairs delivery without creating a second notification', async () => {
  const f = fixture();
  await f.service.deliver(event, 'M1:cycle1', 'user', data('M1:cycle1'));
  f.state().inbox = {};
  await f.service.deliver(event, 'M1:cycle1', 'user', data('M1:cycle1'));
  assert.equal(Object.keys(f.state().notifications).length, 1);
  assert.equal(Object.keys(f.state().inbox).length, 1);
  assert.ok(f.state().logs[`${event}:M1:cycle1`].notificationId);
});

test('stale expiry lifecycle guard prevents inbox and log writes', async () => {
  const f = fixture();
  assert.equal(await f.service.deliver(event, 'M1:old-cycle', 'user', data('M1:old-cycle'), async (session) => { assert.equal(session, f.session); return false; }), null);
  assert.deepEqual(f.state(), { logs: {}, notifications: {}, inbox: {} });
});
