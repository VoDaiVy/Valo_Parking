const test = require('node:test');
const assert = require('node:assert/strict');
const { validateVoucherExpiryChange } = require('../services/voucherService');

const now = new Date('2026-11-25T00:00:00.000Z');
const voucher = (overrides = {}) => ({
  status: 'available',
  expiresAt: new Date('2026-11-30T00:00:00.000Z'),
  usedAt: null,
  bookingId: null,
  ...overrides,
});

test('allows extending an unused voucher and returns a Date', () => {
  const next = validateVoucherExpiryChange(voucher(), '2026-12-10T00:00:00.000Z', now);
  assert.equal(next.toISOString(), '2026-12-10T00:00:00.000Z');
});

test('rejects used, revoked, reserved, and invalid-state vouchers', () => {
  for (const overrides of [
    { status: 'used', usedAt: new Date() },
    { status: 'revoked' },
    { bookingId: 'booking-id' },
  ]) {
    assert.throws(
      () => validateVoucherExpiryChange(voucher(overrides), '2026-12-10T00:00:00.000Z', now),
      (error) => error.code === 'VOUCHER_LOCKED' && error.statusCode === 409,
    );
  }
});

test('requires a strictly later expiry and rejects dates too far ahead', () => {
  assert.throws(() => validateVoucherExpiryChange(voucher(), '2026-11-29T00:00:00.000Z', now), /later than/);
  assert.throws(() => validateVoucherExpiryChange(voucher(), '2026-11-25T00:00:00.000Z', now), /future/);
  assert.throws(() => validateVoucherExpiryChange(voucher(), '2028-01-01T00:00:00.000Z', now), (error) => error.code === 'EXPIRY_TOO_FAR');
});
