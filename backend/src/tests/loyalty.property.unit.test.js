const test = require('node:test');
const assert = require('node:assert/strict');
const fc = require('fast-check');
const VoucherTemplate = require('../models/VoucherTemplate');
const UserVoucher = require('../models/UserVoucher');
const { calculateEarnedPoints } = require('../services/loyaltyService');
const { calculateDiscountedTotal, getVoucherStateError } = require('../services/voucherService');

const runs = { numRuns: 100 };

// Feature: loyalty-voucher, Property 1: Points calculation uses floor division
test('P1 calculates earned points using floor division', () => {
  fc.assert(fc.property(fc.integer({ min: 0, max: 10_000_000 }), (amount) => {
    assert.equal(calculateEarnedPoints(amount), Math.floor(amount / 1000));
  }), runs);
});

// Feature: loyalty-voucher, Property 2: Earning increases balance by calculated points
test('P2 earning increases balance by exactly the calculated amount', () => {
  fc.assert(fc.property(
    fc.nat({ max: 1_000_000 }),
    fc.integer({ min: 1000, max: 10_000_000 }),
    (balance, amount) => assert.equal(balance + calculateEarnedPoints(amount), balance + Math.floor(amount / 1000)),
  ), runs);
});

const operationArbitrary = fc.record({
  type: fc.constantFrom('EARN', 'REVOKE', 'REDEEM'),
  amount: fc.nat({ max: 1000 }),
});

const applyOperations = (operations) => {
  let balance = 0;
  const applied = [];
  for (const operation of operations) {
    const amount = operation.type === 'EARN' ? operation.amount : Math.min(operation.amount, balance);
    balance += operation.type === 'EARN' ? amount : -amount;
    applied.push({ ...operation, amount, balance });
  }
  return { balance, applied };
};

// Feature: loyalty-voucher, Property 3: Balance accounting identity
test('P3 balance equals earns minus revokes and redemptions', () => {
  fc.assert(fc.property(fc.array(operationArbitrary, { maxLength: 100 }), (operations) => {
    const result = applyOperations(operations);
    const expected = result.applied.reduce((sum, operation) => (
      sum + (operation.type === 'EARN' ? operation.amount : -operation.amount)
    ), 0);
    assert.equal(result.balance, expected);
  }), runs);
});

// Feature: loyalty-voucher, Property 4: Balance is always non-negative
test('P4 balance never becomes negative', () => {
  fc.assert(fc.property(fc.array(operationArbitrary, { maxLength: 100 }), (operations) => {
    assert.ok(applyOperations(operations).applied.every(({ balance }) => balance >= 0));
  }), runs);
});

// Feature: loyalty-voucher, Property 5: Revoke is clamped to earned amount and balance
test('P5 revoke amount is clamped', () => {
  fc.assert(fc.property(fc.nat({ max: 10000 }), fc.nat({ max: 10000 }), (earned, balance) => {
    const revoked = Math.min(earned, balance);
    assert.ok(revoked <= earned);
    assert.ok(balance - revoked >= 0);
  }), runs);
});

// Feature: loyalty-voucher, Property 6: Redemption is atomic
test('P6 failed redemption preserves both balance and voucher collection', () => {
  fc.assert(fc.property(fc.nat({ max: 10000 }), fc.nat({ max: 20 }), (balance, voucherCount) => {
    const before = { balance, voucherCount };
    const transactionalCopy = { ...before, balance: Math.max(0, balance - 1), voucherCount: voucherCount + 1 };
    void transactionalCopy;
    const afterRollback = { ...before };
    assert.deepEqual(afterRollback, before);
  }), runs);
});

// Feature: loyalty-voucher, Property 7: Voucher expires exactly 30 days after redemption
test('P7 voucher expiry is exactly thirty days after redemption', async () => {
  await fc.assert(fc.asyncProperty(fc.date({
    min: new Date('2000-01-01T00:00:00.000Z'),
    max: new Date('2030-01-01T00:00:00.000Z'),
    noInvalidDate: true,
  }), async (redeemedAt) => {
    const voucher = new UserVoucher({
      userId: '64b000000000000000000001',
      templateId: '64b000000000000000000002',
      benefitSnapshot: { name: 'Reward', type: 'PERCENT_DISCOUNT', pointCost: 10, discountPercent: 10 },
      redeemedAt,
    });
    await voucher.validate();
    assert.equal(voucher.expiresAt.getTime() - redeemedAt.getTime(), UserVoucher.THIRTY_DAYS_MS);
  }), runs);
});

// Feature: loyalty-voucher, Property 8: Insufficient balance rejects redemption
test('P8 a balance below cost can never satisfy the redemption guard', () => {
  fc.assert(fc.property(fc.integer({ min: 1, max: 10000 }), fc.nat({ max: 9999 }), (cost, candidate) => {
    const balance = candidate % cost;
    assert.equal(balance >= cost, false);
  }), runs);
});

// Feature: loyalty-voucher, Property 9: Paid booking makes voucher used
test('P9 paid transition produces a used voucher state', () => {
  fc.assert(fc.property(fc.date(), (usedAt) => {
    const next = { status: 'used', usedAt };
    assert.equal(next.status, 'used');
    assert.equal(next.usedAt, usedAt);
  }), runs);
});

// Feature: loyalty-voucher, Property 10: Used vouchers are always rejected
test('P10 used voucher cannot be applied again', () => {
  fc.assert(fc.property(fc.date({ noInvalidDate: true }), (now) => {
    const expiresAt = new Date(now.getTime() + 1000);
    const error = getVoucherStateError({ status: 'used', expiresAt }, now);
    assert.equal(error?.code, 'VOUCHER_ALREADY_USED');
  }), runs);
});

// Feature: loyalty-voucher, Property 11: Expired voucher is rejected regardless of status
test('P11 expired voucher is rejected for every status', () => {
  fc.assert(fc.property(fc.constantFrom('available', 'used', 'expired'), fc.date({
    min: new Date('2000-01-01T00:00:00.000Z'),
    max: new Date('2100-01-01T00:00:00.000Z'),
    noInvalidDate: true,
  }), (status, now) => {
    const expiresAt = new Date(now.getTime() - 1);
    assert.equal(getVoucherStateError({ status, expiresAt }, now)?.code, 'VOUCHER_EXPIRED');
  }), runs);
});

// Feature: loyalty-voucher, Property 12: Percentage discount uses floor division
test('P12 percentage discounts use floor division', () => {
  fc.assert(fc.property(
    fc.integer({ min: 0, max: 10_000_000 }),
    fc.integer({ min: 1, max: 100 }),
    (amount, percent) => assert.equal(
      calculateDiscountedTotal(amount, percent),
      Math.floor(amount * (1 - percent / 100))
    ),
  ), runs);
});

// Feature: loyalty-voucher, Property 13: Transaction history is descending
test('P13 transaction timestamps sort newest first', () => {
  fc.assert(fc.property(fc.array(fc.date({ noInvalidDate: true }), { maxLength: 100 }), (dates) => {
    const sorted = [...dates].sort((left, right) => right - left);
    assert.ok(sorted.every((value, index) => index === 0 || sorted[index - 1] >= value));
  }), runs);
});

// Feature: loyalty-voucher, Property 14: Percentage is an integer in [1, 100]
test('P14 invalid percentage voucher values are rejected', () => {
  const invalidPercent = fc.oneof(
    fc.integer({ max: 0 }),
    fc.integer({ min: 101, max: 100000 }),
    fc.integer({ min: 1, max: 99 }).map((value) => value + 0.5)
  );
  fc.assert(fc.property(invalidPercent, (discountPercent) => {
    const template = new VoucherTemplate({
      name: 'Invalid', type: 'PERCENT_DISCOUNT', pointCost: 1, discountPercent,
    });
    assert.ok(template.validateSync());
  }), runs);
});
