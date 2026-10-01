const test = require('node:test');
const assert = require('node:assert/strict');
const { findPricePolicy, applyPricePolicy, resolvePricingBlocks, calculatePrice } = require('../services/pricingEngine');
const { cleanPayload } = require('../services/aiCopilot/draftService');

test('calendar pricing selects the highest priority matching policy', () => {
  const date = new Date(Date.UTC(2026, 11, 25));
  const selected = findPricePolicy([
    { name: 'December', scope: 'month', months: [12], adjustmentPercent: 10, priority: 20, isActive: true },
    { name: 'Christmas', scope: 'date_range', startDate: '2026-12-24', endDate: '2026-12-26', adjustmentPercent: 25, priority: 50, isActive: true },
    { name: 'Disabled', scope: 'date_range', startDate: '2026-12-25', endDate: '2026-12-25', adjustmentPercent: 100, priority: 99, isActive: false },
  ], date);

  assert.equal(selected.name, 'Christmas');
});

test('date range wins a priority tie over month and weekday', () => {
  const selected = findPricePolicy([
    { name: 'Friday', scope: 'weekday', daysOfWeek: [5], adjustmentPercent: 5, priority: 10, isActive: true },
    { name: 'Month', scope: 'month', months: [12], adjustmentPercent: 10, priority: 10, isActive: true },
    { name: 'Holiday', scope: 'date_range', startDate: '2026-12-25', endDate: '2026-12-25', adjustmentPercent: 20, priority: 10, isActive: true },
  ], new Date(Date.UTC(2026, 11, 25)));

  assert.equal(selected.name, 'Holiday');
});

test('calendar adjustment supports discounts and rounds up to 1000 VND', () => {
  assert.equal(applyPricePolicy(15000, { adjustmentPercent: -10 }), 14000);
  assert.equal(applyPricePolicy(15000, { adjustmentPercent: 20 }), 18000);
  assert.equal(applyPricePolicy(15000, null), 15000);
});

test('active day and night blocks replace the regular schedule with two 12-hour prices', () => {
  const blocks = resolvePricingBlocks({
    timeBlocks: [{ startHour: 0, endHour: 24, price: 10000 }],
    dayNightPricing: {
      day: { isActive: true, startHour: 6, price: 50000 },
      night: { isActive: true, startHour: 18, price: 70000 },
    },
  });
  assert.deepEqual(blocks.map(({ startHour, endHour, price, source }) => ({ startHour, endHour, price, source })), [
    { startHour: 18, endHour: 6, price: 70000, source: 'day-night:night' },
    { startHour: 6, endHour: 18, price: 50000, source: 'day-night:day' },
  ]);
});

test('an inactive day/night period falls back to the original time blocks', () => {
  const blocks = resolvePricingBlocks({
    timeBlocks: [
      { startHour: 0, endHour: 12, price: 10000 },
      { startHour: 12, endHour: 24, price: 20000 },
    ],
    dayNightPricing: {
      day: { isActive: true, startHour: 6, price: 50000 },
      night: { isActive: false, startHour: 18, price: 70000 },
    },
  });
  assert.ok(blocks.some((block) => block.source === 'day-night:day' && block.startHour === 6 && block.endHour === 18));
  assert.ok(blocks.some((block) => block.source === 'time-block:0'));
  assert.ok(blocks.some((block) => block.source === 'time-block:1'));
});

test('booking calculation charges the configured 12-hour day price', async () => {
  const result = await calculatePrice(
    new Date('2026-09-24T00:00:00.000Z'),
    new Date('2026-09-24T01:00:00.000Z'),
    true,
    {
      timeBlocks: [{ startHour: 0, endHour: 24, price: 10000 }],
      dayNightPricing: {
        day: { isActive: true, startHour: 6, price: 50000 },
        night: { isActive: true, startHour: 18, price: 70000 },
      },
      pricePolicies: [],
      cap12h: 100000,
      cap24h: 180000,
    }
  );
  assert.equal(result.finalTotal, 50000);
});

test('admin pricing validation preserves valid day/night settings', () => {
  const payload = cleanPayload('MODIFY_PRICING', {
    timeBlocks: [{ startHour: 0, endHour: 24, price: 10000 }],
    cap12h: 100000,
    cap24h: 180000,
    dayNightPricing: {
      day: { isActive: true, startHour: 7, price: 45000 },
      night: { isActive: true, startHour: 19, price: 65000 },
    },
    pricePolicies: [],
  });
  assert.deepEqual(payload.dayNightPricing, {
    day: { isActive: true, startHour: 7, price: 45000 },
    night: { isActive: true, startHour: 19, price: 65000 },
  });
});

test('admin pricing validation rejects overlapping active 12-hour periods', () => {
  assert.throws(() => cleanPayload('MODIFY_PRICING', {
    timeBlocks: [{ startHour: 0, endHour: 24, price: 10000 }],
    cap12h: 100000,
    cap24h: 180000,
    dayNightPricing: {
      day: { isActive: true, startHour: 6, price: 50000 },
      night: { isActive: true, startHour: 17, price: 70000 },
    },
    pricePolicies: [],
  }), /consecutive/);
});
