const test = require('node:test');
const assert = require('node:assert/strict');
const VoucherTemplate = require('../models/VoucherTemplate');
const { calculateEarnedPoints } = require('../services/loyaltyService');
const { calculateDiscountedTotal, getVoucherStateError } = require('../services/voucherService');

test('amounts below 1000 earn no points', () => {
  assert.equal(calculateEarnedPoints(999), 0);
});

test('point calculation never rounds up', () => {
  assert.equal(calculateEarnedPoints(1999), 1);
});

test('a used voucher reports an idempotent rejection code', () => {
  const error = getVoucherStateError({ status: 'used', expiresAt: new Date(Date.now() + 10000) });
  assert.equal(error.code, 'VOUCHER_ALREADY_USED');
});

test('expiry takes precedence over status', () => {
  const error = getVoucherStateError({ status: 'used', expiresAt: new Date(Date.now() - 1) });
  assert.equal(error.code, 'VOUCHER_EXPIRED');
});

test('100 percent voucher reduces the amount to zero', () => {
  assert.equal(calculateDiscountedTotal(25001, 100), 0);
});

test('free-service template requires a service', () => {
  const template = new VoucherTemplate({ name: 'Wash', type: 'FREE_SERVICE', pointCost: 10 });
  assert.ok(template.validateSync()?.errors?.serviceId);
});

test('percentage template requires an integer percentage', () => {
  const template = new VoucherTemplate({
    name: 'Ten percent', type: 'PERCENT_DISCOUNT', pointCost: 10, discountPercent: 10.5,
  });
  assert.ok(template.validateSync()?.errors?.discountPercent);
});
