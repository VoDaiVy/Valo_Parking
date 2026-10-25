import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { createServer } from 'vite';
import postcss from 'postcss';

let server; let hooks; let Session; let Customer; let Memberships;
const storageBefore = { local: globalThis.localStorage, session: globalThis.sessionStorage };
let role = 'staff';
before(async () => {
  globalThis.localStorage = { getItem: () => 'mock-token' };
  globalThis.sessionStorage = { getItem: () => JSON.stringify({ role }) };
  server = await createServer({
    optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, hmr: false }, appType: 'custom',
    plugins: [{
      name: 'g3-isolated-render-fixtures', enforce: 'pre',
      resolveId(id) { if (id === 'virtual:g3-hooks') return '\0g3-hooks'; },
      load(id) {
        if (id !== '\0g3-hooks') return;
        return `export { Fragment } from 'react';
          let states = [], cursor = 0;
          export const seed = (values) => { states = values; cursor = 0; };
          export const useState = (initial) => [cursor < states.length ? states[cursor++] : (cursor++, typeof initial === 'function' ? initial() : initial), () => {}];
          export const useEffect = () => {};
          export const useMemo = (fn) => fn();
          export const useCallback = (fn) => fn;
          export const useRef = (value) => ({ current: value });`;
      },
      transform(source, id) {
        if (!/\/pages\/(Staff\/(SessionManagement|AccountManagement)|Admin\/SubscriptionManagement)\.jsx$/.test(id.replaceAll('\\', '/'))) return;
        return source.replace(/from ['"]react['"]/, "from 'virtual:g3-hooks'");
      },
    }],
  });
  hooks = await server.ssrLoadModule('virtual:g3-hooks');
  Session = (await server.ssrLoadModule('/src/pages/Staff/SessionManagement.jsx')).default;
  Customer = (await server.ssrLoadModule('/src/pages/Staff/AccountManagement.jsx')).default;
  Memberships = (await server.ssrLoadModule('/src/pages/Admin/SubscriptionManagement.jsx')).default;
});
after(async () => {
  await server?.close();
  globalThis.localStorage = storageBefore.local;
  globalThis.sessionStorage = storageBefore.session;
});
const render = (Component, path, states, userRole = 'staff') => {
  role = userRole; hooks.seed(states);
  return renderToStaticMarkup(React.createElement(MemoryRouter, { initialEntries: [path] }, React.createElement(Component)));
};
const session = { _id: 'session-123', licensePlate: '51A-12345', phone: '0912345678', status: 'completed', totalPrice: 490000, checkInTime: '2026-10-20T08:00:00Z', checkOutTime: '2026-10-21T08:00:00Z' };
const sessionState = (overrides = {}) => {
  const values = [[session], false, '', null, 1, '', 'all', 'newest', false, '', null, { status: 'idle' }, 0];
  for (const [index, value] of Object.entries(overrides)) values[index] = value;
  return values;
};

test('G3A Session retains all seven columns, filters, row values and existing detail action', () => {
  const html = render(Session, '/staff/sessions', sessionState());
  for (const label of ['License Plate', 'Phone', 'Status', 'Check In', 'Check Out', 'Price', 'Actions', 'View Details', 'AI Plate Assistant']) assert.ok(html.includes(label));
  assert.ok(html.includes('51A-12345'));
  assert.ok(html.includes('490.000'));
  assert.ok(html.includes('Filter sessions by status'));
  assert.ok(html.includes('Sort sessions'));
  assert.ok(html.includes('g3-data-row'));
});
test('G3A Session preserves loading, error, empty and filtered-empty messages', () => {
  assert.ok(render(Session, '/staff/sessions', sessionState({ 1: true })).includes('Loading sessions...'));
  assert.ok(render(Session, '/staff/sessions', sessionState({ 2: 'Mock failure' })).includes('Session data unavailable'));
  assert.ok(render(Session, '/staff/sessions', sessionState({ 0: [] })).includes('No sessions found.'));
  assert.ok(render(Session, '/staff/sessions', sessionState({ 5: 'no-match' })).includes('No matching sessions.'));
});
test('G3A detail markup remains outside the new presentation regions', () => {
  const source = readFileSync(new URL('../SessionManagement.jsx', import.meta.url), 'utf8');
  assert.ok(!source.slice(source.indexOf('{/* Detail Modal */}')).includes('g3-'));
  const html = render(Session, '/staff/sessions', sessionState({ 3: session }));
  for (const text of ['Session Details', 'Entry Record', 'Exit Record', 'No Entry Image', 'No Exit Image', 'Close']) assert.ok(html.includes(text));
});
test('G3A Admin Session retains its existing header label and detail view', () => {
  const html = render(Session, '/admin/sessions', sessionState({ 3: session }), 'admin');
  assert.ok(html.includes('Session Manager'));
  assert.ok(!html.includes('VALO / Staff Operations'));
  assert.ok(html.includes('Session Details'));
});
test('G4 Session Details keeps original entry/exit image sources, geometry and timestamps', () => {
  const withImages = { ...session, entryImage_url: '/mock/entry.jpg', exitImage_url: '/mock/exit.jpg' };
  const html = render(Session, '/staff/sessions', sessionState({ 3: withImages }));
  for (const text of ['g4-session-dialog', 'g4-session-header', 'g4-session-footer', 'g4-session-close', 'grid-cols-2 gap-8', 'src="/mock/entry.jpg"', 'src="/mock/exit.jpg"', 'object-cover', 'Vehicle 51A-12345', 'Check In Time', 'Check Out Time']) assert.ok(html.includes(text));
  assert.equal((html.match(/g4-session-image /g) || []).length, 2);
  assert.ok(!html.includes('No Entry Image'));
  assert.ok(!html.includes('No Exit Image'));
});
test('G4 AI Plate trigger retains its original purple utility styling and existing label', () => {
  const html = render(Session, '/staff/sessions', sessionState());
  const trigger = html.match(/<button[^>]*class="([^"]*g4-ai-plate-trigger[^"]*)"[^>]*>/)?.[1];
  assert.ok(trigger);
  for (const token of ['from-fuchsia-500/20', 'to-violet-500/20', 'border-violet-400/40', 'text-violet-300']) assert.ok(trigger.includes(token));
  assert.ok(!trigger.split(' ').includes('g3-action'));
  assert.ok(html.includes('AI Plate Assistant'));
  assert.ok(!html.includes('g4-session-dialog'));
});
test('G4 colors are confined to Staff Details/trigger without changing modal or image layout', () => {
  const source = readFileSync(new URL('./sessionDetails.css', import.meta.url), 'utf8');
  const css = postcss.parse(source);
  css.walkRules((rule) => {
    for (const selector of postcss.list.comma(rule.selector)) {
      assert.match(selector, /^body\[data-valo-typography="staff"\]/);
      assert.ok(selector.includes('.g4-'));
      assert.ok(!selector.includes(' img'));
    }
  });
  css.walkDecls((decl) => assert.ok(!['width', 'height', 'padding', 'margin', 'display', 'position', 'grid-template-columns', 'aspect-ratio', 'object-fit', 'z-index', 'animation', 'transform'].includes(decl.prop)));
  for (const color of ['#080B0F', '#092019', '#0B1015', '#0D1519', '#54E3B0', '#16C99A', '#06130F', '#C084FC']) assert.ok(source.includes(color));
  assert.ok(source.includes('prefers-reduced-motion: reduce'));
  assert.doesNotMatch(source, /valo-ai|g3-data-row|g3-metric|g3-vip/);
});
test('G4 modal text and emerald Close button keep readable contrast', () => {
  const css = postcss.parse(readFileSync(new URL('./sessionDetails.css', import.meta.url), 'utf8'));
  const pairs = [];
  css.walkRules((rule) => {
    if (!rule.selector.endsWith('.g4-session-dialog') && !rule.selector.endsWith('.g4-session-close')) return;
    const values = new Map(rule.nodes.filter((node) => node.type === 'decl').map((node) => [node.prop, node.value]));
    pairs.push([values.get('color'), values.get('background')]);
  });
  const luminance = (hex) => [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16) / 255)
    .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
    .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
  assert.equal(pairs.length, 2);
  for (const pair of pairs) {
    const [dark, light] = pair.map(luminance).sort((a, b) => a - b);
    assert.ok((light + 0.05) / (dark + 0.05) >= 4.5);
  }
});
const now = new Date().toISOString();
const customer = { _id: 'customer-1', username: 'driver', email: 'driver@example.test', role: 'customer', status: true, emailVerified: false, createdAt: now, profile: { firstName: 'Test', lastName: 'Driver', phone: '0912345678' } };
const customerState = (overrides = {}) => {
  const values = [[customer], false, '', '', 'all', 1, null, false, {}, 'idle', false, 'newest', null, 1, 1, 0, 1];
  for (const [index, value] of Object.entries(overrides)) values[index] = value;
  return values;
};
test('G3B Customer keeps four source-backed metrics, table columns and edit/pagination actions', () => {
  const html = render(Customer, '/staff/accounts', customerState());
  for (const text of ['Total Customers', 'New This Month', 'Blocked Customers', 'Pending Verify', 'Test Driver', 'driver@example.test', '0912345678', 'Joined Date', 'Edit account', 'Page 1 of 1']) assert.ok(html.includes(text));
  assert.ok(html.includes('g3-customer-metrics'));
  assert.ok(html.includes('g3-page-active'));
  assert.ok(html.includes('disabled=""'));
});
test('G3B Customer retains error, empty and skeleton loading states', () => {
  assert.ok(render(Customer, '/staff/accounts', customerState({ 0: [], 2: 'Mock failure' })).includes('Customer data unavailable'));
  assert.ok(render(Customer, '/staff/accounts', customerState({ 0: [] })).includes('No customers match your filters'));
  assert.ok(render(Customer, '/staff/accounts', customerState({ 1: true })).includes('animate-skeleton'));
});
test('G3B drawer, edit form and block confirmation remain unchanged and outside the main scope', () => {
  const source = readFileSync(new URL('../AccountManagement.jsx', import.meta.url), 'utf8');
  assert.ok(!source.slice(source.indexOf('RIGHT: DETAIL PANEL')).includes('g3-'));
  const detail = render(Customer, '/staff/accounts', customerState({ 6: customer }));
  for (const text of ['Customer Detail', 'Basic Info', 'Block Customer', 'Edit Customer']) assert.ok(detail.includes(text));
  const edit = render(Customer, '/staff/accounts', customerState({ 6: customer, 7: true, 8: { fullName: 'Test Driver', phone: '0912345678', role: 'customer' } }));
  assert.ok(edit.includes('Save Changes'));
  assert.ok(edit.includes('value="Test Driver"'));
  assert.ok(render(Customer, '/staff/accounts', customerState({ 6: customer, 10: true })).includes('Confirm Block'));
});
const future = new Date(Date.now() + 10 * 86400000).toISOString();
const subscription = { _id: 'membership-1', user: { username: 'driver', email: 'driver@example.test', vehicles: ['51A-12345'] }, ticketPackage: { name: 'Premium Monthly', type: 'monthly' }, status: 'active', amount: 50000, paymentStatus: 'paid', validFrom: now, expireAt: future, slots: [{ floorId: { _id: 'floor-1', name: 'Floor 1' }, slotCode: 'A01' }] };
const membershipState = (overrides = {}) => {
  const values = [[subscription], false, '', '', false, '', 'all', 'all', [], { status: 'loading' }];
  for (const [index, value] of Object.entries(overrides)) values[index] = value;
  return values;
};
test('G3C VIP keeps three Staff metrics, membership columns, values and available filters', () => {
  const html = render(Memberships, '/staff/subscriptions', membershipState());
  for (const text of ['VIP Memberships', 'Total VIP', 'Active', 'Expiring Soon', 'Premium Monthly', 'driver@example.test', '50.000 VND', 'A01', 'Paid', 'Filter subscriptions by status', 'Filter subscriptions by package']) assert.ok(html.includes(text));
  assert.ok(html.includes('g3-membership-row'));
  assert.ok(!html.includes('Transfer reviews'));
  assert.ok(!html.includes('View Details'));
});
test('G3C VIP preserves loading, error, empty and clear-filter states', () => {
  assert.ok(render(Memberships, '/staff/subscriptions', membershipState({ 1: true })).includes('animate-pulse'));
  assert.ok(render(Memberships, '/staff/subscriptions', membershipState({ 0: [], 2: 'Mock failure' })).includes('Subscription data unavailable'));
  assert.ok(render(Memberships, '/staff/subscriptions', membershipState({ 0: [] })).includes('No VIP memberships found'));
  assert.ok(render(Memberships, '/staff/subscriptions', membershipState({ 5: 'no-match' })).includes('Clear filters'));
});
test('G3C VIP status and package identities keep their source mappings', () => {
  for (const status of ['active', 'pending', 'expired', 'cancelled', 'failed']) {
    const html = render(Memberships, '/staff/subscriptions', membershipState({ 0: [{ ...subscription, status }] }));
    assert.ok(html.includes(status.charAt(0).toUpperCase() + status.slice(1)));
    assert.ok(html.includes('Premium Monthly'));
    assert.ok(html.includes('g3-package-badge'));
  }
});
test('G3C Admin retains its header, fourth metric and transfer review controls', () => {
  const transfer = { _id: 'transfer-1', status: 'PENDING_ADMIN', mode: 'PUBLIC', entitlementId: { slotCode: 'A01' }, fromUserId: { email: 'driver@example.test' }, askingPrice: 10000, transferFee: 1000 };
  const html = render(Memberships, '/admin/subscriptions', membershipState({ 8: [transfer] }), 'admin');
  for (const text of ['VIP Subscriptions', 'Transfers', 'Transfer reviews', 'Approve &amp; list 7d', 'Reject']) assert.ok(html.includes(text));
  assert.ok(!html.includes('VALO / Staff Operations'));
});
test('shared G3 styles require Staff role and explicit main-content hooks, with motion-safe effects', () => {
  const source = readFileSync(new URL('./staffManagement.css', import.meta.url), 'utf8');
  const css = postcss.parse(source);
  css.walkRules((rule) => {
    if (rule.parent.type === 'atrule' && rule.parent.name === 'keyframes') return;
    for (const selector of postcss.list.comma(rule.selector)) {
      assert.match(selector, /^body\[data-valo-typography="staff"\]/);
      assert.ok(selector.includes('.g3-'));
    }
  });
  assert.ok(source.includes('640ms'));
  assert.ok(source.includes('prefers-reduced-motion: reduce'));
  assert.ok(source.includes(':focus-within'));
  assert.ok(source.includes(':focus-visible'));
  assert.ok(source.includes('inset 2px 0 0 #10B981'));
  assert.doesNotMatch(source, /infinite|valo-ai|staff-dash-|\.fixed|\.panel-slide-in/);
});

test('G3 body, ice-blue headers and action labels meet normal-text contrast', () => {
  const source = readFileSync(new URL('./staffManagement.css', import.meta.url), 'utf8');
  const tokens = new Map();
  const colors = new Map();
  postcss.parse(source).walkRules((rule) => {
    for (const node of rule.nodes) if (node.type === 'decl' && node.prop.startsWith('--g3-')) tokens.set(node.prop, node.value);
    if (rule.selector.endsWith('.g3-action')) for (const node of rule.nodes) if (node.type === 'decl') colors.set(node.prop, node.value);
  });
  const resolve = (color) => color.startsWith('var(') ? tokens.get(color.slice(4, -1)) : color;
  const luminance = (color) => [1, 3, 5].map((start) => parseInt(resolve(color).slice(start, start + 2), 16) / 255)
    .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
    .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
  for (const [fg, bg] of [['var(--g3-text)', 'var(--g3-bg)'], ['var(--g3-muted)', 'var(--g3-surface)'], ['var(--g3-ice)', '#14212A'], [colors.get('color'), colors.get('background')]]) {
    const [dark, light] = [luminance(fg), luminance(bg)].sort((a, b) => a - b);
    assert.ok((light + 0.05) / (dark + 0.05) >= 4.5);
  }
});
