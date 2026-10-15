const test = require('node:test');
const assert = require('node:assert/strict');
const { monthOf, validateProgram, selectTier, bookingSpend, WEEK_MS } = require('../services/spendRewardRules');
const { quarterOf, quarterMonths } = require('../services/quarterlyLeaderboardService');
const config = () => ({ enabled: true, revision: 0, tiers: [
  { threshold: 300000, discountAmount: 20000, minimumAmount: 100000 },
  { threshold: 700000, discountAmount: 50000, minimumAmount: 200000 },
] });
test('Vietnam month boundary and exactly seven days', () => {
  assert.equal(monthOf('2026-09-30T16:59:59Z'), '2026-09');
  assert.equal(monthOf('2026-09-30T17:00:00Z'), '2026-10');
  assert.equal(WEEK_MS, 604800000);
  assert.throws(() => monthOf('invalid'));
});
test('quarter boundaries use Vietnam-local month and reject malformed quarters', () => {
  assert.equal(quarterOf(monthOf('2026-12-31T16:59:59Z')), '2026-Q4');
  assert.equal(quarterOf(monthOf('2026-12-31T17:00:00Z')), '2027-Q1');
  assert.deepEqual(quarterMonths('2026-Q4'), ['2026-10', '2026-11', '2026-12']);
  assert.throws(() => quarterMonths('2026-Q0'));
});
test('only highest newly reached milestone; refunds cannot re-award old tiers', () => {
  const tiers = config().tiers;
  assert.equal(selectTier(tiers, 299999, 0), null);
  assert.equal(selectTier(tiers, 300000, 0).discountAmount, 20000);
  assert.equal(selectTier(tiers, 900000, 0).threshold, 700000);
  assert.equal(selectTier(tiers, 900000, 700000), null);
});
test('program rejects invalid money, duplicate tiers, over-discounts and malformed settings', () => {
  for (const value of ['', '300000', -1, 0, 999, 1.5, NaN, Infinity, 1000000001]) {
    const input = config(); input.tiers[0].threshold = value;
    assert.throws(() => validateProgram(input));
  }
  assert.throws(() => validateProgram({ ...config(), enabled: 'true' }));
  assert.throws(() => validateProgram({ ...config(), revision: -1 }));
  assert.throws(() => validateProgram({ ...config(), tiers: [] }));
  assert.throws(() => validateProgram({ ...config(), tiers: [config().tiers[0], config().tiers[0]] }));
  const input = config(); input.tiers[0].discountAmount = 100001;
  assert.throws(() => validateProgram(input));
  assert.equal(validateProgram(config()).tiers.length, 2);
});
test('settled spending includes actual extras, subtracts actual refunds, excludes cancelled bookings', () => {
  const booking = { status: 'COMPLETED', prepaidAmount: 300000, paidOverageAdjustments: [{ amount: 10000 }], refundSettlements: [{ payoutStatus: 'credited', netWalletAmount: 50000 }, { payoutStatus: 'suppressed', netWalletAmount: 500 }] };
  assert.equal(bookingSpend(booking), 260000);
  assert.equal(bookingSpend({ ...booking, status: 'CANCELLED' }), 0);
  assert.equal(bookingSpend({ ...booking, refundSettlements: [{ payoutStatus: 'debited', netWalletAmount: -20000 }] }), 330000);
  assert.equal(bookingSpend({ ...booking, status: 'PAID', paidAt: new Date() }), 260000);
  assert.equal(bookingSpend({ ...booking, status: 'ACTIVE', paidAt: new Date() }), 260000);
  assert.equal(bookingSpend({ ...booking, status: 'CANCELLED', paidAt: new Date() }), 260000);
});
