const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MAX_VEHICLES_PER_USER,
  getVehicleCapacity,
} = require('../services/vehicleCapacityService');

test('allows vehicle registration while the account is below the limit', () => {
  assert.deepEqual(getVehicleCapacity(2), {
    count: 2,
    limit: MAX_VEHICLES_PER_USER,
    remaining: 1,
    limitReached: false,
  });
});

test('blocks vehicle registration at and above the three-vehicle limit', () => {
  assert.equal(getVehicleCapacity(3).limitReached, true);
  assert.equal(getVehicleCapacity(4).limitReached, true);
  assert.equal(getVehicleCapacity(3).remaining, 0);
});
