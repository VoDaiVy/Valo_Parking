const assert = require('node:assert/strict');
const test = require('node:test');
const { getOccupancyForecast } = require('../services/demandForecastingService');

test('demandForecastingService returns valid 24h forecast structure', async () => {
  const result = await getOccupancyForecast({
    date: '2026-09-08',
    hour: 14,
    vehicleType: 'car',
    timeframe: 'day',
  });

  assert.ok(result, 'Result should exist');
  assert.equal(result.timeframe, 'day');
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
  assert.ok(result.dataQuality);
  assert.equal(typeof result.dataQuality.usesFallbackBaseline, 'boolean');
});

test('demandForecastingService returns valid 7-day weekly forecast structure', async () => {
  const result = await getOccupancyForecast({
    date: '2026-09-08',
    timeframe: 'week',
    selectedIndex: 2,
  });

  assert.ok(result, 'Result should exist');
  assert.equal(result.timeframe, 'week');
  assert.ok(Array.isArray(result.items));
  assert.equal(result.items.length, 7);
  assert.equal(result.items[0].label, 'Mon');
  assert.equal(result.items[6].label, 'Sun');
  assert.equal(result.selectedIndex, 2);
  assert.ok(result.selectedItem);
  assert.ok(result.insight);
  assert.ok(result.insight.badgeText);
  assert.ok(Array.isArray(result.peakWindows));
});

test('demandForecastingService returns valid monthly forecast structure', async () => {
  const result = await getOccupancyForecast({
    date: '2026-09-08',
    timeframe: 'month',
    selectedIndex: 1,
  });

  assert.ok(result, 'Result should exist');
  assert.equal(result.timeframe, 'month');
  assert.ok(Array.isArray(result.items));
  assert.equal(result.items.length, 5);
  assert.equal(result.items[0].label, 'Week 1');
  assert.ok(result.selectedItem);
  assert.ok(result.insight);
});

test('demandForecastingService returns valid 12-month yearly forecast structure', async () => {
  const result = await getOccupancyForecast({
    date: '2026-09-08',
    timeframe: 'year',
    selectedIndex: 8,
  });

  assert.ok(result, 'Result should exist');
  assert.equal(result.timeframe, 'year');
  assert.ok(Array.isArray(result.items));
  assert.equal(result.items.length, 12);
  assert.equal(result.items[0].label, 'Jan');
  assert.equal(result.items[11].label, 'Dec');
  assert.ok(result.selectedItem);
  assert.ok(result.insight);
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

test('demandForecastingService uses Booking scheduledStart/scheduledEnd fields', () => {
  const fs = require('node:fs');
  const source = fs.readFileSync(
    require.resolve('../services/demandForecastingService'),
    'utf8'
  );

  assert.match(source, /scheduledStart/);
  assert.match(source, /scheduledEnd/);
  assert.doesNotMatch(source, /startTime: \{ \$gte/);
});

test('far-date daily forecast is explicitly reference-only', async () => {
  const result = await getOccupancyForecast({
    date: '2099-01-01',
    hour: 10,
    timeframe: 'day',
    forecastHorizonHours: 24,
  });
  assert.equal(result.isReferenceOnly, true);
  assert.equal(result.isDynamicPricingEligible, false);
  assert.equal(result.forecastHorizonHours, 24);
});
