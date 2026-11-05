import test from 'node:test';
import assert from 'node:assert/strict';
import { membershipTiming, membershipDate, membershipPresentation, membershipFloorName } from './membershipDisplay.js';

test('M1 fixture uses exact expiration instant and Vietnam calendar day', () => {
  const expires = '2026-10-22T03:00:00.000Z'; // 10:00 Vietnam, fixture only.
  assert.equal(membershipTiming(expires, 'active', new Date('2026-10-21T18:00:00Z')).label, 'Expires today');
  assert.equal(membershipTiming(expires, 'active', new Date('2026-10-22T02:59:59.999Z')).status, 'active');
  assert.deepEqual(membershipTiming(expires, 'active', new Date(expires)), { status: 'expired', daysRemaining: 0, label: 'Expired' });
  assert.equal(membershipTiming(expires, 'active', new Date('2026-10-22T04:00:00Z')).label, 'Expired');
  assert.notEqual(membershipTiming(expires, 'active', new Date('2026-10-21T16:59:59Z')).label, 'Expires today');
  assert.notEqual(membershipTiming(expires, 'cancelled', new Date('2026-10-22T02:00:00Z')).label, 'Expires today');
  assert.match(membershipDate(expires), /22 Oct 2026, 10:00/);
});

test('each entitlement uses its own instant, without the aggregate latest expiry', () => {
  const now = new Date('2026-10-22T04:00:00Z');
  assert.deepEqual(['2026-10-22T03:00:00Z', '2026-10-22T05:00:00Z', '2026-11-22T03:00:00Z'].map((expireAt) => membershipTiming(expireAt, 'active', now).label), ['Expired', 'Expires today', '31 days remaining']);
});

test('presentation uses each space window and current time, never grants renewal from a date alone', () => {
  const now = new Date('2030-01-01T00:00:00Z');
  const entity = { expireAt: '2030-01-06T00:00:00Z', status: 'active', renewal: { canRenew: false, renewalWindowDays: 3, message: 'Window not open' } };
  assert.equal(membershipPresentation(entity, now).state, 'ACTIVE');
  assert.equal(membershipPresentation({ ...entity, renewal: { ...entity.renewal, renewalWindowDays: 5 } }, now).state, 'EXPIRING_SOON');
  assert.equal(membershipPresentation({ ...entity, expireAt: '2030-01-01T01:00:00Z' }, now).state, 'EXPIRES_TODAY');
  assert.equal(membershipPresentation(entity, now).canRenew, false);
  assert.equal(membershipPresentation(entity, now).renewalMessage, 'Window not open');
  assert.equal(membershipPresentation({ ...entity, renewal: { canRenew: true }, expireAt: now.toISOString() }, now).canRenew, false);
  assert.equal(membershipPresentation({ ...entity, renewal: { canRenew: true }, expireAt: now.toISOString() }, now).state, 'EXPIRED');
  assert.equal(membershipPresentation({ ...entity, renewal: { canRenew: true }, status: 'transfer_locked' }, now).canRenew, false);
  assert.equal(membershipPresentation({ ...entity, renewal: { canRenew: true }, expireAt: 'invalid' }, now).canRenew, false);
});

test('floor display preserves numeric zero, empty names, missing numbers and normal formatting', () => {
  assert.equal(membershipFloorName('', 0), 0);
  assert.equal(membershipFloorName(undefined, 0), 0);
  assert.equal(membershipFloorName('   ', 0), 0);
  assert.equal(membershipFloorName('', undefined), 'Unavailable');
  assert.equal(membershipFloorName(null, null), 'Unavailable');
  assert.equal(membershipFloorName('', 2), 2);
  assert.equal(membershipFloorName('Basement', -1), 'Basement');
  assert.equal(membershipFloorName('', 'Floor 0'), 'Floor 0');
});
