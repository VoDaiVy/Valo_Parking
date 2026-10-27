import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { getTimelineSegments, getScheduleStatus, serializeConfig } from './pricingDisplay.js';

let server;
let panels;
before(async () => {
  server = await createServer({ optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, hmr: false }, appType: 'custom' });
  panels = await server.ssrLoadModule('/src/pages/Admin/PricingPanels.jsx');
});
after(async () => { await server?.close(); });
const render = (name, props) => renderToStaticMarkup(React.createElement(panels[name], props));
const noop = () => {};
const blocks = [{ startHour: 7, endHour: 12, price: 10000 }, { startHour: 12, endHour: 22, price: 34000 }, { startHour: 22, endHour: 7, price: 25000 }];

test('flat KPI strip preserves derived values without decorative chart silhouettes', () => {
  const html = render('PricingOverview', { timeBlocks: blocks });
  assert.ok(html.includes('<dd>3</dd>'));
  assert.ok(html.includes('10.000 VND'));
  assert.ok(html.includes('34.000 VND'));
  assert.ok(!html.includes('pricing-metric-chart'));
  assert.ok(!html.includes('<button'));
  const empty = render('PricingOverview', { timeBlocks: [] });
  assert.equal((empty.match(/<dd>—<\/dd>/g) || []).length, 2);
});

test('timeline preserves real widths and shared overnight identity without changing records', () => {
  const before = JSON.stringify(blocks);
  const segments = getTimelineSegments(blocks);
  assert.equal(segments.length, 4);
  assert.ok(Math.abs(segments.reduce((sum, segment) => sum + segment.width, 0) - 100) < 1e-9);
  const overnight = segments.filter((segment) => segment.sourceIndex === 2);
  assert.equal(overnight.length, 2);
  assert.equal(overnight[0].color, overnight[1].color);
  assert.equal(segments[0].width, 5 / 24 * 100);
  assert.equal(JSON.stringify(blocks), before);
});

test('mocked schedule has actionable segment buttons, a legend and initially hidden details', () => {
  const html = render('PricingSchedule', { timeBlocks: blocks, onSelect: noop });
  assert.equal((html.match(/class="pricing-segment pricing-tone-/g) || []).length, 4);
  assert.ok(html.includes('aria-expanded="false"'));
  assert.ok(html.includes('aria-controls="pricing-schedule-details"'));
  assert.ok(html.includes('id="pricing-schedule-details" hidden=""'));
  assert.ok(html.includes('View details'));
  assert.ok(html.includes('class="pricing-legend"'));
  assert.ok(html.includes('per block'));
});

test('mocked editor renders one record per block with real edit inputs and accessible delete actions', () => {
  const html = render('TimeBlockEditor', { timeBlocks: blocks, onAdd: noop, onChange: noop, onRemove: noop, selectedBlock: 2 });
  assert.equal((html.match(/id="pricing-block-/g) || []).length, 3);
  assert.ok(html.includes('Overnight'));
  assert.ok(html.includes('aria-label="Start time for block 1"'));
  assert.ok(html.includes('aria-label="Delete time block 3"'));
  assert.ok(html.includes('value="34000"'));
  assert.ok(!html.includes('Hourly'));
});

test('saved additional rules render collapsed and read only without losing zero-valued caps', () => {
  const html = render('AdditionalPricingRules', { config: { cap12h: 0, cap24h: 123456, dayNightPricing: { day: { isActive: true, startHour: 6, price: 45500 } } } });
  assert.ok(html.startsWith('<details class="pricing-panel pricing-additional">'));
  assert.ok(html.includes('0 VND cap'));
  assert.ok(html.includes('123.456 VND cap'));
  assert.ok(html.includes('45.500 VND per block'));
  assert.ok(!/<(?:input|select|button)\b/.test(html));
});

test('calendar scope controls and active states retain their persisted representations', () => {
  const policy = { name: 'Holiday', scope: 'date_range', startDate: '2026-12-25', endDate: '2026-12-25', adjustmentPercent: -10, priority: 50, isActive: false };
  const props = { policies: [policy], onAdd: noop, onChange: noop, onRemove: noop };
  const html = render('PricePolicyEditor', props);
  assert.equal((html.match(/type="date"/g) || []).length, 2);
  assert.ok(html.includes('value="decrease" selected=""'));
  assert.ok(html.includes('aria-label="Delete policy Holiday"'));
  assert.ok(html.includes('aria-pressed="false"'));
  const weekday = render('PricePolicyEditor', { ...props, policies: [{ ...policy, scope: 'weekday', daysOfWeek: [5] }] });
  assert.ok(!weekday.includes('type="date"'));
  assert.ok(weekday.includes('aria-pressed="true"'));
  const baseline = JSON.parse(serializeConfig(blocks, { day: { isActive: false, price: 12345 } }, [policy]));
  assert.equal(baseline.pricePolicies[0].scope, 'date_range');
  assert.equal(baseline.pricePolicies[0].adjustmentPercent, -10);
  assert.equal(baseline.dayNightPricing.day.price, 12345);
});

test('coverage continues to expose invalid schedules without claiming validity', () => {
  assert.equal(getScheduleStatus(blocks).tone, 'success');
  for (const invalid of [blocks.slice(1), [...blocks, blocks[0]]]) {
    const status = getScheduleStatus(invalid);
    assert.notEqual(status.tone, 'success');
    assert.ok(!render('PricingSummary', { timeBlocks: invalid, status }).includes('Configuration is valid'));
  }
});

test('only schedule and editor lose their outer cards; actions and disclosure remain accessible', () => {
  const schedule = render('PricingSchedule', { timeBlocks: blocks, onSelect: noop });
  const editor = render('TimeBlockEditor', { timeBlocks: blocks, onAdd: noop, onChange: noop, onRemove: noop });
  assert.ok(schedule.startsWith('<section class="pricing-schedule">'));
  assert.ok(editor.startsWith('<section class="pricing-editor">'));
  assert.ok(schedule.includes('aria-expanded="false"'));
  assert.ok(schedule.includes('Pricing schedule generated from the time blocks below.'));
  assert.ok(editor.includes('aria-label="Edit fee for time block 1"'));
  assert.ok(editor.includes('aria-label="Delete time block 1"'));
  assert.ok(editor.includes('Add time block'));
  assert.ok(render('AdditionalPricingRules', { config: {} }).startsWith('<details class="pricing-panel pricing-additional">'));
});

test('calendar policies have individual cards with name and actions grouped in the header', () => {
  const policy = { name: 'Weekend', scope: 'weekday', daysOfWeek: [0, 6], adjustmentPercent: -10, priority: 50, isActive: true };
  const html = render('PricePolicyEditor', { policies: [policy], onAdd: noop, onChange: noop, onRemove: noop });
  assert.ok(html.startsWith('<section class="pricing-policies"'));
  assert.equal((html.match(/class="pricing-policy-card"/g) || []).length, 1);
  const header = html.slice(html.indexOf('<header class="pricing-policy-header">'), html.indexOf('</header>'));
  assert.ok(header.includes('value="Weekend"'));
  assert.ok(header.includes('aria-label="Toggle policy Weekend"'));
  assert.ok(header.includes('aria-label="Delete policy Weekend"'));
  assert.ok(header.includes('>Active</button>'));
  assert.ok(html.includes('Decrease the applicable base fee by 10%.'));
  assert.ok(html.includes('class="pricing-policy-percent"'));
  assert.ok(!html.includes('bg-black'));
});

test('calendar numeric blanks remain visible drafts, and inactive policies remain editable', () => {
  const policy = { name: 'Draft', scope: 'month', months: [12], daysOfWeek: [2], adjustmentPercent: '', priority: '', isActive: false };
  const html = render('PricePolicyEditor', { policies: [policy], onAdd: noop, onChange: noop, onRemove: noop });
  assert.ok(html.includes('>Inactive</button>'));
  assert.ok(html.includes('aria-label="Adjustment percentage"'));
  assert.match(html, /type="number" min="0" max="500" step="any"[^>]*value=""/);
  assert.match(html, /type="number" min="0" max="10000"[^>]*value=""/);
  assert.ok(html.includes('Enter a percentage adjustment.'));
  assert.ok(html.includes('aria-pressed="true">Month 12'));
  assert.ok(!html.includes(' disabled'));
  assert.deepEqual(policy.daysOfWeek, [2]);
});
