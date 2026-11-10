import test from 'node:test';
import assert from 'node:assert/strict';
import { applyNotificationRead, markAllUnreadNotifications } from './notificationReadState.js';

test('mark all snapshots every unread page before writes, including notifications outside the current filter', async () => {
  let rows = Array.from({ length: 45 }, (_, index) => ({ _id: String(index), isRead: false, severity: index % 2 ? 'WARNING' : 'CRITICAL' }));
  const requests = [];
  let count = rows.length;
  const result = await markAllUnreadNotifications({
    getNotifications: async (filter, page) => {
      requests.push(`get:${filter}:${page}`);
      const unread = rows.filter(row => !row.isRead);
      return { ok: true, data: { data: { notifications: unread.slice((page - 1) * 20, page * 20), total: unread.length } } };
    },
    markRead: async id => { requests.push(`read:${id}`); return { ok: true }; },
    onRead: id => { rows = applyNotificationRead(rows, id, 'all'); count -= 1; },
  });
  assert.deepEqual(requests.slice(0, 3), ['get:unread:1', 'get:unread:2', 'get:unread:3']);
  assert.equal(result.readIds.length, 45); assert.deepEqual(result.failedIds, []);
  assert.ok(rows.every(row => row.isRead)); assert.equal(count, 0);
});

test('individual failures remain unread while successful requests update immediately and can be retried', async () => {
  let rows = [{ _id: 'a', isRead: false }, { _id: 'b', isRead: false }, { _id: 'c', isRead: false }];
  const result = await markAllUnreadNotifications({
    getNotifications: async () => ({ ok: true, data: { data: { notifications: rows, total: rows.length } } }),
    markRead: async id => { if (id === 'c') throw new Error('network'); return { ok: id !== 'b' }; },
    onRead: id => { rows = applyNotificationRead(rows, id, 'unread'); },
  });
  assert.deepEqual(result.readIds, ['a']); assert.deepEqual(new Set(result.failedIds), new Set(['b', 'c']));
  assert.deepEqual(rows.map(row => row._id), ['b', 'c']);
});

test('pagination failures do not perform partial bulk writes and empty snapshots perform none', async () => {
  let writes = 0;
  const args = { markRead: async () => { writes += 1; return { ok: true }; }, onRead: () => assert.fail('No successful reads expected') };
  await assert.rejects(markAllUnreadNotifications({ ...args, getNotifications: async (_, page) => page === 1 ? { ok: true, data: { data: { notifications: [{ _id: 'a' }], total: 2 } } } : { ok: false } }));
  assert.equal(writes, 0);
  const result = await markAllUnreadNotifications({ ...args, getNotifications: async () => ({ ok: true, data: { data: { notifications: [], total: 0 } } }) });
  assert.deepEqual(result, { readIds: [], failedIds: [] }); assert.equal(writes, 0);
});

test('overlapping pages deduplicate IDs, skip read records, and all filters retain unrelated states', async () => {
  const patched = [];
  await markAllUnreadNotifications({
    getNotifications: async (_, page) => ({ ok: true, data: { data: { total: 4, notifications: page === 1 ? [{ _id: 'a' }, { _id: 'b' }] : [{ _id: 'a' }, { _id: 'c', isRead: true }] } } }),
    markRead: async id => { patched.push(id); return { ok: true }; }, onRead: () => {},
  });
  assert.deepEqual(patched, ['a', 'b']);
  const rows = [{ _id: 'a', isRead: false, severity: 'WARNING' }, { _id: 'b', isRead: true, severity: 'CRITICAL' }];
  for (const filter of ['all', 'warning', 'critical']) {
    const next = applyNotificationRead(rows, 'a', filter);
    assert.equal(next[0].isRead, true); assert.strictEqual(next[1], rows[1]);
  }
  assert.deepEqual(applyNotificationRead(rows, 'a', 'unread'), [rows[1]]);
  assert.equal(rows[0].isRead, false);
});
