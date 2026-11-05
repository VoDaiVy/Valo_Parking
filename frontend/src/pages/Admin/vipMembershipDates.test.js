import test from 'node:test';
import assert from 'node:assert/strict';
import { vipDate, vipDaysUntil } from './vipMembershipDates.js';
test('Admin expiry uses the backend instant and Vietnam calendar day across UTC midnight', () => {
  const now = new Date('2026-10-31T16:30:00Z');
  assert.equal(vipDaysUntil('2026-10-31T16:59:59Z', now), 0);
  assert.equal(vipDaysUntil('2026-10-31T17:00:00Z', now), 1);
  assert.equal(vipDate('2026-10-31T17:00:00Z'), '01 Nov 2026');
  assert.equal(vipDaysUntil('2026-10-30T16:30:00Z', now), -1);
  for (const value of [null, '', 'invalid']) {
    assert.equal(vipDaysUntil(value, now), null);
    assert.equal(vipDate(value), 'Not available');
  }
});
