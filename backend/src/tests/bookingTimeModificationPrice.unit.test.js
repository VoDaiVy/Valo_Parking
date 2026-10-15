const test = require('node:test');
const assert = require('node:assert/strict');

const {
  calculateModifiedBookingPrice,
} = require('../services/bookingTimeModificationService');

test('time modification keeps paid services while repricing parking', () => {
  const result = calculateModifiedBookingPrice({
    booking: {
      prepaidAmount: 120_000,
      paymentBreakdownSnapshot: { parkingAmount: 100_000, serviceAmount: 20_000 },
    },
    parkingPrice: 200_000,
  });

  assert.equal(result.newParkingAmount, 200_000);
  assert.equal(result.preservedNonParkingAmount, 20_000);
  assert.equal(result.newPrice, 220_000);
});

test('time modification preserves the captured voucher benefit', () => {
  const result = calculateModifiedBookingPrice({
    booking: {
      prepaidAmount: 108_000,
      paymentBreakdownSnapshot: {
        parkingAmount: 100_000,
        serviceAmount: 20_000,
        voucherDiscount: 12_000,
      },
    },
    parkingPrice: 200_000,
  });

  assert.equal(result.preservedNonParkingAmount, 8_000);
  assert.equal(result.newPrice, 208_000);
});

test('legacy booking without a payment breakdown only reprices parking', () => {
  const result = calculateModifiedBookingPrice({
    booking: { prepaidAmount: 75_000 },
    parkingPrice: 125_000,
  });

  assert.equal(result.preservedNonParkingAmount, 0);
  assert.equal(result.newPrice, 125_000);
});

test('a captured discount never makes the modified booking total negative', () => {
  const result = calculateModifiedBookingPrice({
    booking: {
      prepaidAmount: 0,
      paymentBreakdownSnapshot: { parkingAmount: 100_000, voucherDiscount: 100_000 },
    },
    parkingPrice: 50_000,
  });

  assert.equal(result.newPrice, 0);
});
