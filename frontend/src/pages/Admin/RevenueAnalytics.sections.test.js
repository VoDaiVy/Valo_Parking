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
  assert.match(source, /<SourceSummaryStrip items=\{sourceSummary\}/);
});
