import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import postcss from 'postcss';
import { buildStaffDashboardMetrics, buildStaffLotDiagnostics, getStaffDashboardSyncStatus, getStaffDashboardViewAvailability } from '../../../utils/staffDashboardDiagnostics.js';
import { getOperationalViewState } from '../../../utils/staffOperationalAvailability.js';

let server;
let view;
before(async () => {
  server = await createServer({ optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, hmr: false }, appType: 'custom' });
  view = await server.ssrLoadModule('/src/pages/Staff/components/StaffDashboardView.jsx');
});
after(async () => { await server?.close(); });
const noop = () => {};
const floors = [{ _id: 'floor-1', name: 'Floor 1', layoutData: { elements: [{ id: 'slot-1', name: 'A01', type: 'slot' }] } }];
const bookings = [{ _id: 'booking1234', licensePlate: '51A-12345', parkingSlot: 'A01', status: 'PENDING', floorId: 'floor-1', createdAt: '2026-10-25T08:00:00Z' }];
const metrics = buildStaffDashboardMetrics({ floors, bookings, sessions: [{ floorId: 'floor-1', parkingSlot: 'A01', status: 'active' }] });
const syncStatus = getStaffDashboardSyncStatus({ floors: true, bookings: true, sessions: true, slotsOk: true, revenue: true });
const base = {
  loading: false, floors, metrics, syncStatus,
  viewAvailability: getStaffDashboardViewAvailability(syncStatus.sources),
  revenueState: getOperationalViewState({ loading: false, error: '' }),
  revenueStatistics: { vip: { revenue: 120000, transactionCount: 2 }, booking: { revenue: 30000, completedCount: 1 }, service: { revenue: 10000, completedBookingCount: 1 }, totalRevenue: 160000 },
  activeFloorZones: [{ key: 'A', label: 'Zone A', slots: [{ id: 'slot-1', name: 'A01' }] }],
  getSlotData: () => ({ status: 'OCCUPIED', plate: '51A-12345', isVip: true }),
  lotDiagnostics: buildStaffLotDiagnostics({ metrics }), navigate: noop,
  selectedGate: 'ENTRY_1', setSelectedGate: noop, gateOpen: false, gateHold: false,
  isTriggeringGate: false, handleOpenGate: noop, handleCloseGate: noop, handleToggleHoldGate: noop,
};
const render = (props = {}) => renderToStaticMarkup(React.createElement(view.default, { ...base, ...props }));
const textOf = (node) => {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node !== 'object') return String(node);
  return React.Children.toArray(node.props?.children).map(textOf).join('');
};
const elements = (node) => !node || typeof node !== 'object' ? [] : [node, ...React.Children.toArray(node.props?.children).flatMap(elements)];

test('seven existing KPIs and recent bookings render from mocked data', () => {
  const html = render();
  assert.equal((html.match(/class="staff-dash-metric"/g) || []).length, 7);
  for (const amount of ['120.000', '30.000', '10.000', '160.000']) assert.ok(html.includes(amount));
  assert.ok(html.includes('100% occupancy · Floor 1'));
  assert.ok(html.includes('2 paid transactions'));
  assert.ok(html.includes('51A-12345'));
  assert.ok(html.includes('Sensor and camera health is not verified'));
  assert.ok(!html.includes('Gate A-01 sensors and cameras operating normally'));
});
test('Dashboard sections render immediately while initial data is still pending', () => {
  const pending = getStaffDashboardSyncStatus();
  const html = render({ loading: true, floors: [], metrics: buildStaffDashboardMetrics({}), syncStatus: pending, viewAvailability: getStaffDashboardViewAvailability(pending.sources), revenueState: getOperationalViewState({ loading: true }), activeFloorZones: [], lotDiagnostics: [] });
  assert.ok(html.includes('aria-busy="true"'));
  assert.ok(html.includes('Updating data'));
  assert.ok(!html.includes('Syncing system data'));
  for (const label of ['Operations overview', 'Revenue', 'Live Grid', 'Gate &amp; actions', 'Open entry gate']) assert.ok(html.includes(label));
  assert.equal((html.match(/class="staff-dash-metric"/g) || []).length, 7);
  assert.ok(!html.includes('160.000'));
  assert.ok(!html.includes('Data synchronized'));
});
test('failed sources remain unavailable instead of showing real-looking values', () => {
  const failed = getStaffDashboardSyncStatus();
  const html = render({ syncStatus: failed, viewAvailability: getStaffDashboardViewAvailability(failed.sources), revenueState: getOperationalViewState({ loading: false, error: 'Revenue unavailable' }), lotDiagnostics: buildStaffLotDiagnostics({ availability: failed }) });
  for (const message of ['Operational sync unavailable', 'Live grid data unavailable', 'Activity data unavailable', 'Revenue unavailable']) assert.ok(html.includes(message));
  assert.ok(!html.includes('120.000'));
  assert.ok(!html.includes('Data synchronized'));
  assert.ok(!html.includes('class="staff-dash-slot '));
});
test('successful empty results keep real zero values and empty-state messaging', () => {
  const html = render({ floors: [], metrics: buildStaffDashboardMetrics({}), activeFloorZones: [] });
  assert.ok(html.includes('No slot layout found'));
  assert.ok(html.includes('No booking activity'));
  assert.ok(html.includes('No floor configured'));
  assert.ok(html.includes('staff-type-kpi">0</p>'));
});
test('compact slots retain status, VIP, plate and native keyboard button semantics', () => {
  for (const status of ['EMPTY', 'OCCUPIED', 'RESERVED', 'MAINTENANCE']) {
    let clicked = false;
    const props = { id: 'slot-1', name: 'A01', status, plate: '51A-12345', isVip: true, onClick: () => { clicked = true; } };
    const html = renderToStaticMarkup(React.createElement(view.DashboardSlot, props));
    assert.ok(html.startsWith('<button type="button"'));
    assert.ok(html.includes(`A01, ${status}, 51A-12345, VIP. Open Live Grid`));
    view.DashboardSlot(props).props.onClick();
    assert.equal(clicked, true);
  }
  const empty = renderToStaticMarkup(React.createElement(view.DashboardSlot, { id: 'x', name: 'A01', status: 'EMPTY', onClick: noop }));
  assert.ok(!empty.includes('staff-dash-slot-plate'));
});
test('slot navigation, selected-gate commands, busy state and shortcuts are preserved', () => {
  const calls = [];
  for (const gateOpen of [false, true]) {
    const nodes = elements(view.default({ ...base, selectedGate: 'EXIT_1', gateOpen, gateHold: true,
      navigate: (path) => calls.push(path), setSelectedGate: (gate) => calls.push(gate),
      handleOpenGate: (gate) => calls.push(`open:${gate}`), handleCloseGate: (gate) => calls.push(`close:${gate}`), handleToggleHoldGate: (gate) => calls.push(`hold:${gate}`),
    }));
    const action = (label) => nodes.find((node) => node.type === 'button' && textOf(node) === label);
    action(gateOpen ? 'Close gate' : 'Open exit gate').props.onClick();
    action('Resume barrier').props.onClick();
    action('Entry gate').props.onClick();
    nodes.find((node) => node.type === view.DashboardSlot).props.onClick();
    for (const label of ['Process Exit', 'Scan QR Code', 'Update Slot']) assert.ok(nodes.some((node) => node.type === 'button' && textOf(node).includes(label)));
  }
  assert.deepEqual(calls, ['open:EXIT_1', 'hold:EXIT_1', 'ENTRY_1', '/staff/live-grid', 'close:EXIT_1', 'hold:EXIT_1', 'ENTRY_1', '/staff/live-grid']);
  assert.equal((render({ isTriggeringGate: true }).match(/disabled=""/g) || []).length, 2);
});
test('command-center styling stays Staff scoped, compact and motion-aware without nested cards', () => {
  const source = readFileSync(new URL('./staffDashboard.css', import.meta.url), 'utf8');
  const css = postcss.parse(source);
  css.walkRules((rule) => postcss.list.comma(rule.selector).forEach((selector) => assert.match(selector, /^body\[data-valo-typography="staff"\]/)));
  css.walkDecls((decl) => assert.ok(!decl.important));
  for (const text of ['height: 95px', '1280px', '1199px', '899px', '639px', ':focus-visible', 'prefers-reduced-motion: reduce', 'transition: none']) assert.ok(source.includes(text));
  assert.doesNotMatch(source, /@keyframes|animation:/);
  const html = render();
  assert.equal((html.match(/class="staff-dash-gates"/g) || []).length, 1);
  assert.ok(html.includes('class="staff-dash-parking"'));
  assert.ok(!html.includes('staff-dash-panel'));
});

test('asymmetric capacity feature and primary financial total retain all seven metrics', () => {
  const html = render();
  assert.ok(html.includes('class="staff-dash-instruments"'));
  assert.ok(html.includes('aria-label="Managed slots" data-emphasis="capacity"'));
  assert.ok(html.includes('aria-label="Platform revenue" data-emphasis="revenue"'));
  assert.ok(html.indexOf('aria-label="Platform revenue"') < html.indexOf('aria-label="VIP revenue"'));
  assert.ok(html.includes('class="staff-dash-revenue-breakdown"'));
  assert.ok(!html.includes('role="progressbar"'));
  assert.ok(!html.includes('forecast'));
});

test('normal text and primary action colors meet 4.5:1 contrast including hover', () => {
  const tokens = new Map();
  for (const path of ['../../../styles/staffTypography.css', './staffDashboard.css']) {
    postcss.parse(readFileSync(new URL(path, import.meta.url), 'utf8')).walkDecls((decl) => {
      if (decl.prop.startsWith('--staff-')) tokens.set(decl.prop, decl.value);
    });
  }
  const resolve = (value) => value.startsWith('var(') ? tokens.get(value.slice(4, -1)) : value;
  const luminance = (hex) => {
    const channels = [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16) / 255)
      .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return channels.reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
  };
  const assertContrast = (fg, bg) => {
    const [dark, light] = [luminance(resolve(fg)), luminance(resolve(bg))].sort((a, b) => a - b);
    assert.ok((light + 0.05) / (dark + 0.05) >= 4.5, `${fg} on ${bg}`);
  };
  assertContrast('var(--staff-text-primary)', 'var(--staff-bg)');
  assertContrast('var(--staff-text-secondary)', 'var(--staff-surface)');
  assertContrast('var(--staff-accent)', 'var(--staff-surface-raised)');
  let actionPairs = 0;
  postcss.parse(readFileSync(new URL('./staffDashboard.css', import.meta.url), 'utf8')).walkRules((rule) => {
    if (!rule.selector.endsWith('.staff-dash-primary') && !rule.selector.endsWith('.staff-dash-primary:hover:enabled')) return;
    const declarations = new Map(rule.nodes.map((decl) => [decl.prop, decl.value]));
    if (!declarations.has('color') || !declarations.has('background')) return;
    actionPairs++;
    assertContrast(declarations.get('color'), declarations.get('background'));
  });
  assert.equal(actionPairs, 2);
});


test('slot interaction styles preserve status colors, selection and scroll-safe focus without motion', () => {
  const css = postcss.parse(readFileSync(new URL('./staffDashboard.css', import.meta.url), 'utf8'));
  const rules = [];
  css.walkRules((rule) => rules.push(rule));
  for (const [status, color] of Object.entries({ empty: '#54B88C', occupied: '#79A9D4', reserved: '#C6A15E', maintenance: '#CC8997' })) {
    assert.ok(rules.some((rule) => rule.selector.endsWith(`.staff-dash-slot-${status}`) && rule.nodes.some((decl) => decl.prop === '--slot-interaction' && decl.value === color)));
  }
  const interaction = rules.find((rule) => rule.selector.includes('.staff-dash-slot:is(:hover, :focus-visible)'));
  for (const guard of [':not(:active)', ':not([aria-selected="true"])', ':not([aria-pressed="true"])', ':not([data-selected="true"])', ':not(.selected)', ':not(.is-selected)']) assert.ok(interaction.selector.includes(guard));
  assert.deepEqual(interaction.nodes.map((decl) => decl.prop), ['border-color']);
  const focus = rules.find((rule) => rule.selector.endsWith('.staff-dash-slot:focus-visible'));
  assert.ok(focus.nodes.some((decl) => decl.prop === 'outline-offset' && decl.value === '-4px'));
  const slot = rules.find((rule) => rule.selector.endsWith(' .staff-dash-slot'));
  assert.ok(slot.nodes.some((decl) => decl.prop === 'transition' && decl.value === 'border-color 180ms, background-color 180ms'));
  assert.ok(!rules.some((rule) => rule.selector.includes('.staff-dash-slot') && rule.selector.includes(':hover') && rule.nodes.some((decl) => ['transform', 'box-shadow', 'background'].includes(decl.prop))));
});
