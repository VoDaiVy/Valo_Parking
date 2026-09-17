import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('./RevenueAnalytics.jsx', import.meta.url), 'utf8');

test('revenue analytics omits booking and package summary blocks', () => {
  assert.doesNotMatch(source, /title="Booking Flow"/);
  assert.doesNotMatch(source, /title="Package Performance"/);
});

test('revenue analytics preserves the detailed sections', () => {
  assert.match(source, />\s*Status Distribution\s*</);
  assert.match(source, />\s*Value by Package\s*</);
  assert.match(source, /<SalesTrendChart/);
});

test('revenue analytics omits the legacy AI insights strip', () => {
  assert.doesNotMatch(source, />\s*AI Insights\s*</);
  assert.doesNotMatch(source, /getAdminAIAnalyticsSummary/);
  assert.doesNotMatch(source, /\/admin\/revenue\/ai\//);
});
