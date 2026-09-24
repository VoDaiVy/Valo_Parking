import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('./RevenueAnalytics.jsx', import.meta.url), 'utf8');

test('revenue analytics uses single API call via getAdminPlatformRevenueByMode', () => {
  assert.match(source, /getAdminPlatformRevenueByMode/);
  // Should NOT call separate booking/subscription statistics
  assert.doesNotMatch(source, /getAdminBookingStatistics/);
  assert.doesNotMatch(source, /getAdminSubscriptionStatistics/);
});

test('revenue analytics has 6 KPI labels', () => {
  assert.match(source, /Total Revenue/);
  assert.match(source, /Booking Revenue/);
  assert.match(source, /Service Revenue/);
  assert.match(source, /Package Revenue/);
  assert.match(source, /Transfer Fees/);
  assert.match(source, /Refunds/);
});

test('revenue analytics preserves the detailed sections', () => {
  assert.match(source, />\s*Status Distribution\s*</);
  assert.match(source, />\s*Value by Package\s*</);
  assert.match(source, /<RevenueTrendChart/);
});

test('revenue analytics includes Revenue by Source section', () => {
  assert.match(source, /Revenue by Source/);
  assert.match(source, /sourceCompositionTotal/);
});

test('revenue analytics includes Vehicle Traffic section', () => {
  assert.match(source, /Vehicle Traffic/);
  assert.match(source, /Parked/);
  assert.match(source, /Active/);
});

test('revenue analytics has mode controls (7d, month, quarter, year)', () => {
  assert.match(source, /'7d'/);
  assert.match(source, /'month'/);
  assert.match(source, /'quarter'/);
  assert.match(source, /'year'/);
});

test('revenue analytics has Total/By Source toggle', () => {
  assert.match(source, /By Source/);
  assert.match(source, /viewMode.*total/);
  assert.match(source, /viewMode.*bySource/);
});

test('revenue analytics omits the legacy AI insights strip', () => {
  assert.doesNotMatch(source, />\s*AI Insights\s*</);
  assert.doesNotMatch(source, /getAdminAIAnalyticsSummary/);
  assert.doesNotMatch(source, /\/admin\/revenue\/ai\//);
});

test('revenue analytics does not render comparison percentages', () => {
  assert.doesNotMatch(source, /comparison/i);
  assert.doesNotMatch(source, /vs previous/i);
});

test('revenue analytics safe() utility prevents NaN/Infinity', () => {
  // Verify the safe() function is defined and used
  assert.match(source, /const safe/);
  assert.match(source, /Number\.isFinite/);
});
