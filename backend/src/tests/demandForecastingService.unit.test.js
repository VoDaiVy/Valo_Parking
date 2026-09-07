const assert = require('node:assert/strict');
const test = require('node:test');
const { getOccupancyForecast } = require('../services/demandForecastingService');

test('demandForecastingService returns valid 24h forecast structure', async () => {
  const result = await getOccupancyForecast({
    date: '2026-09-08',
    hour: 14,
    vehicleType: 'car',
  });

  assert.ok(result, 'Result should exist');
  assert.equal(typeof result.date, 'string');
  assert.equal(typeof result.dayOfWeekName, 'string');
  assert.equal(typeof result.totalCapacity, 'number');
  assert.ok(result.totalCapacity > 0);
  assert.equal(result.selectedHour, 14);

  // Hourly forecast array
  assert.ok(Array.isArray(result.hourlyForecast));
  assert.equal(result.hourlyForecast.length, 24);

  const sampleHour = result.hourlyForecast[14];
  assert.equal(sampleHour.hour, 14);
  assert.equal(typeof sampleHour.busynessScore, 'number');
  assert.ok(sampleHour.busynessScore >= 0 && sampleHour.busynessScore <= 100);
  assert.ok(['low', 'moderate', 'high', 'peak'].includes(sampleHour.level));
  assert.ok(sampleHour.estimatedAvailableSlots >= 0);

  // Insight
  assert.ok(result.insight);
  assert.ok(result.insight.badgeText);
  assert.ok(result.insight.message);

  // Peak windows
  assert.ok(Array.isArray(result.peakWindows));
  assert.ok(result.peakWindows.length > 0);
});

test('demandForecastingService gracefully handles undefined or empty params', async () => {
  const result = await getOccupancyForecast({});
  assert.ok(result);
  assert.equal(result.hourlyForecast.length, 24);
  assert.ok(result.selectedForecast);
  assert.equal(typeof result.maintenanceSlotsCount, 'number');
  assert.equal(typeof result.totalPhysicalCapacity, 'number');
});

test('demandForecastingService supports floorId filtering', async () => {
  const result = await getOccupancyForecast({
    floorId: '6a55b5d67910237199e6cbf2',
    vehicleType: 'car',
  });
  assert.ok(result);
  assert.equal(typeof result.totalCapacity, 'number');
  assert.equal(typeof result.maintenanceSlotsCount, 'number');
  assert.equal(typeof result.totalPhysicalCapacity, 'number');
});
