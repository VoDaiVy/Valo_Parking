const test = require('node:test');
const assert = require('node:assert/strict');
const { renewalWindowDays, isInRenewalWindow } = require('../utils/membershipRenewalWindow');

test('exact default seven-day boundary and package-specific windows use milliseconds', () => {
  const expiry = new Date('2026-10-22T13:42:46.553Z');
  const opens = new Date('2026-10-15T13:42:46.553Z');
  assert.equal(renewalWindowDays({}), 7);
  assert.equal(isInRenewalWindow(expiry, {}, new Date(opens.getTime() - 1)), false);
  assert.equal(isInRenewalWindow(expiry, {}, opens), true);
  assert.equal(isInRenewalWindow(expiry, {}, new Date(opens.getTime() + 1)), true);
  assert.equal(isInRenewalWindow(expiry, {}, new Date(expiry.getTime() - 1)), true);
  assert.equal(isInRenewalWindow(expiry, {}, expiry), false);
  assert.equal(isInRenewalWindow(expiry, {}, new Date(expiry.getTime() + 1)), false);
  assert.equal(isInRenewalWindow(expiry, { renewalWindowDays: 2 }, opens), false);
  assert.equal(isInRenewalWindow(expiry, { renewalWindowDays: 10 }, opens), true);
  assert.equal(isInRenewalWindow('invalid', {}), false);
});
