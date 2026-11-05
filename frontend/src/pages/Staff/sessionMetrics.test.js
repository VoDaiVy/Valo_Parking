import test from 'node:test';
import assert from 'node:assert/strict';
import { sessionMetrics } from './sessionMetrics.js';
import { paginateSessions, filterAndSortSessions } from './sessionPagination.js';

const now = new Date('2026-10-31T17:00:00Z'); // 1 Nov, midnight in Vietnam.
test('session KPIs use the complete API list independently of filtered/paginated rows', () => {
  const sessions = Array.from({ length: 32 }, (_, index) => ({
    _id: String(index), licensePlate: `TEST-${index}`, status: 'active',
    checkInTime: '2026-10-31T16:00:00Z', expectedDurationHours: 2,
  }));
  const filtered = filterAndSortSessions(sessions, { searchQuery: 'TEST-31' });
  assert.equal(paginateSessions(filtered, 1).totalItems, 1);
  assert.deepEqual(sessionMetrics(sessions, now), { total: 32, parked: 32, completedToday: 0, needsAttention: 0 });
});
test('completed today uses actual checkout, completed status and Vietnam calendar boundaries', () => {
  const sessions = [
    { status: 'completed', checkOutTime: '2026-10-31T16:59:59Z' },
    { status: 'completed', checkOutTime: '2026-10-31T17:00:00Z' },
    { status: 'completed', checkOutTime: '2026-11-01T16:59:59Z' },
    { status: 'completed', checkOutTime: '2026-11-01T17:00:00Z' },
    { status: 'cancelled', checkOutTime: now },
    { status: 'completed', checkOutTime: null },
    { status: 'completed', checkOutTime: 'invalid' },
  ];
  assert.deepEqual(sessionMetrics(sessions, now), { total: 7, parked: 0, completedToday: 2, needsAttention: 0 });
});
test('attention matches strict overdue timing and ignores completed/cancelled records', () => {
  const session = { status: 'active', checkInTime: '2026-10-31T16:00:00Z', expectedDurationHours: 1 };
  assert.equal(sessionMetrics([session], now).needsAttention, 0);
  assert.equal(sessionMetrics([session], new Date(now.getTime() + 1)).needsAttention, 1);
  assert.equal(sessionMetrics([{ ...session, status: 'completed' }, { ...session, status: 'cancelled' }], new Date(now.getTime() + 1)).needsAttention, 0);
});
test('missing active timing never masquerades as a reliable zero; empty list is a real zero', () => {
  for (const fields of [{ checkInTime: null, expectedDurationHours: 1 }, { checkInTime: 'bad', expectedDurationHours: 1 }, { checkInTime: now }, { checkInTime: now, expectedDurationHours: '' }, { checkInTime: now, expectedDurationHours: 'bad' }]) {
    const result = sessionMetrics([{ status: 'active', ...fields }], now);
    assert.equal(result.needsAttention, null);
    assert.equal(result.parked, 1);
  }
  assert.deepEqual(sessionMetrics([], now), { total: 0, parked: 0, completedToday: 0, needsAttention: 0 });
});
