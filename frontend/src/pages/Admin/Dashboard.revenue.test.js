import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { transformWithOxc } from 'vite';
const source = readFileSync(new URL('./Dashboard.jsx', import.meta.url), 'utf8');
const section = source.slice(source.indexOf('function RevenueSummary('), source.indexOf('function RecentAdminActivity('));
const compiled = await transformWithOxc(section, 'RevenueSummary.jsx', { jsx: { runtime: 'classic' } });
const money = value => `${value} VND`;
const Component = new Function('React', 'useNavigate', 'useCountUp', 'formatCurrency', 'DashboardSection', 'SectionHeader', 'ChevronRight', 'ChartNoAxesCombined', 'Wallet', 'Ticket', 'RotateCw', `${compiled.code}; return RevenueSummary;`)(React, () => () => {}, money, money, ({ children }) => React.createElement('section', null, children), ({ title }) => React.createElement('header', null, title), () => null, () => null, () => null, () => null, () => null);
const finance = { currentRecordedSources: 450, previousRecordedSources: 300, coverage: 'partial', walletBookingCharges: 100, packagePayments: 200, renewalValue: 50, sourceAvailability: { current: true, previous: true, wallet: true, packages: true } };
const render = (props = {}) => renderToStaticMarkup(React.createElement(Component, { finance, loading: false, ...props }));
test('summary uses reported amounts and discloses partial coverage without growth percentages', () => {
  const html = render();
  for (const label of ['450 VND', '300 VND', '100 VND', '200 VND', '50 VND', 'Partial data', 'not a verified total revenue', 'View Revenue Analytics']) assert.ok(html.includes(label), label);
  for (const label of ['Difference', 'Violation revenue', 'Membership transfer fees', 'Recorded Revenue', 'Change vs previous period', 'Recorded sources, not a verified total revenue</p>', '%']) assert.ok(!html.includes(label), label);
  assert.ok(section.includes("navigate('/admin/revenue')"));
});
test('missing source amounts remain unavailable while genuine zero is visible', () => {
  const html = render({ finance: { ...finance, sourceAvailability: {} } });
  assert.ok(!html.includes('300 VND'));
  assert.ok(!html.includes('100 VND'));
  assert.ok(render({ finance: { ...finance, walletBookingCharges: 0 } }).includes('>0 VND<'));
});
test('loading and API errors keep analytics navigation available', () => {
  assert.ok(render({ loading: true }).includes('Loading revenue summary'));
  const html = render({ finance: { ...finance, error: 'Revenue unavailable' } });
  assert.ok(html.includes('role="alert"'));
  assert.ok(html.includes('Revenue unavailable'));
  assert.ok(html.includes('View Revenue Analytics'));
});
const parkingSource = source.slice(source.indexOf('function ParkingOperation('), source.indexOf('function QuickAction('));
const parkingCompiled = await transformWithOxc(parkingSource, 'ParkingOperation.jsx', { jsx: { runtime: 'classic' } });
const Icon = () => null;
const Parking = new Function('React', 'Car', 'CheckCircle2', 'AlertTriangle', 'Activity', `${parkingCompiled.code}; return ParkingOperation;`)(React, Icon, Icon, Icon, Icon);
const renderParking = (operation, loading = false) => renderToStaticMarkup(React.createElement(Parking, { operation, loading }));
test('parking preserves real zero, unavailable timing, loading and error states', () => {
  const empty = renderParking({ metrics: { total: 0, parked: 0, completedToday: 0, needsAttention: 0 } });
  assert.ok(empty.includes('No parking sessions recorded.'));
  assert.equal((empty.match(/>0<\/dd>/g) || []).length, 3);
  assert.ok(renderParking({ metrics: { parked: 1, completedToday: 0, needsAttention: null } }).includes('Unavailable'));
  assert.ok(renderParking({ metrics: null }, true).includes('Loading parking sessions...'));
  assert.ok(renderParking({ metrics: null, error: 'Sessions unavailable' }).includes('role="alert"'));
  const populated = renderParking({ metrics: { total: 3, parked: 1, completedToday: 2, needsAttention: 0 } });
  assert.ok(!populated.includes('Attention indicates'));
});
