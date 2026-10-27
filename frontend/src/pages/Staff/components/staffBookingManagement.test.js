import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setImmediate } from 'node:timers';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import postcss from 'postcss';
import selectorParser from 'postcss-selector-parser';

// Real component handlers/effects run with isolated hooks and API fixtures.
// This is not a browser or React DOM interaction test.
let server; let hooks; let api; let module;
before(async () => {
  server = await createServer({
    optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, hmr: false }, appType: 'custom',
    plugins: [{
      name: 'isolated-booking-ui', enforce: 'pre',
      resolveId(id) { if (id.startsWith('virtual:booking-')) return `\0${id}`; },
      load(id) {
        if (id === '\0virtual:booking-hooks') return `
          let state = [], cursor = 0, effects = [];
          export const seed = (values) => { state = [...values]; cursor = 0; effects = []; };
          export const begin = () => { cursor = 0; effects = []; };
          export const values = () => state;
          export const pendingEffects = () => effects;
          export const useState = (initial) => {
            const key = cursor++;
            if (!(key in state)) state[key] = typeof initial === 'function' ? initial() : initial;
            return [state[key], (value) => { state[key] = typeof value === 'function' ? value(state[key]) : value; }];
          };
          export const useEffect = (fn) => { effects.push(fn); };
          export const useMemo = (fn) => fn();
        `;
        if (id === '\0virtual:booking-api') return `
          export const calls = []; export const queryChanges = [];
          let query = '', bookingResponse, floorResponse, statisticsResponse;
          export const configure = (options = {}) => {
            calls.length = 0; queryChanges.length = 0; query = options.query || '';
            bookingResponse = options.bookings || {ok: true, data: {success: true, data: []}};
            floorResponse = options.floors || {ok: true, data: {success: true, data: []}};
            statisticsResponse = options.statistics || {ok: true, data: {success: true, data: {completed: {}, cancelled: {}}}};
          };
          export const useSearchParams = () => [new URLSearchParams(query), (value) => queryChanges.push(value)];
          export const getAllFloors = async () => { calls.push(['floors']); return floorResponse; };
          export const getAllBookings = async (params) => { calls.push(['bookings', params]); return bookingResponse; };
          export const getAdminBookingStatistics = async (range, filters) => { calls.push(['statistics', range, filters]); return statisticsResponse; };
        `;
      },
      transform(source, id) {
        if (!id.replaceAll('\\', '/').endsWith('/pages/Staff/BookingManagement.jsx')) return;
        return source.replace("from 'react'", "from 'virtual:booking-hooks'")
          .replace("from 'react-router-dom'", "from 'virtual:booking-api'")
          .replace(/from '\.\.\/\.\.\/services\/(parkingFloorService|bookingService|statisticsService)'/g, "from 'virtual:booking-api'")
          + '\nexport { ProgressBar, getBookingGroup, getBookingDisplayStatus };';
      },
    }],
  });
  hooks = await server.ssrLoadModule('virtual:booking-hooks');
  api = await server.ssrLoadModule('virtual:booking-api');
  module = await server.ssrLoadModule('/src/pages/Staff/BookingManagement.jsx');
});
after(async () => { await server?.close(); });
const floors = [{_id: 'floor-1', name: 'Floor 1', floorNumber: 1}, {_id: 'floor-2', name: 'Floor 2', floorNumber: 2}];
const now = new Date('2026-10-25T05:00:00Z');
const record = (id, status, start = '2026-10-25T03:00:00Z', end = '2026-10-25T06:00:00Z') => ({
  _id: id, status, licensePlate: `51A-${id}`, userId: {fullName: `Driver ${id}`, email: `${id}@example.test`, phone: '0912345678'},
  floorId: floors[0], parkingSlot: `A${id}`, scheduledStart: start, scheduledEnd: end, durationHours: 3,
  prepaidAmount: 25000, paymentMethod: 'wallet', createdAt: start, updatedAt: end,
  financialSummary: {prepaidCollected: 25000, additionalCollected: 10000, refundPaid: 8000, actualRevenue: 27000},
});
const bookings = [record('pending', 'PENDING'), record('active', 'ACTIVE'), record('paid', 'PAID'), record('paused', 'PAUSED'), record('completed', 'COMPLETED'), record('cancelled', 'CANCELLED'), record('expired', 'EXPIRED')];
const statistics = {completed: {count: 7, grossRevenue: 350000, prepaidRevenue: 300000, additionalRevenue: 50000, refundPaid: 20000, actualRevenue: 330000}, cancelled: {count: 2}, period: {startDate: '2026-10-24T17:00:00Z', endDate: '2026-10-25T16:59:59.999Z'}, availability: {earliestBookingAt: '2026-01-01T00:00:00Z', latestBookingAt: '2026-10-25T06:00:00Z'}};
const state = (overrides = {}) => Object.assign([false, new Date('2026-10-25T00:00:00'), floors, bookings, false, '', 'all', '', null, 'daily', statistics, false, '', 0, now, now], overrides);
const tree = () => { hooks.begin(); return module.default(); };
const htmlOf = (node) => renderToStaticMarkup(node);
const nodes = (node) => !node || typeof node !== 'object' ? [] : [node, ...React.Children.toArray(node.props?.children).flatMap(nodes)];
const textOf = (node) => {
  if (node == null || typeof node === 'boolean') return '';
  return typeof node === 'object' ? React.Children.toArray(node.props?.children).map(textOf).join('') : String(node);
};
const button = (page, text) => nodes(page).find((node) => node.type === 'button' && textOf(node) === text);
const rows = (page) => nodes(page).filter((node) => node.props?.className?.includes('sbm-booking-row'));
const detail = (page) => nodes(page).find((node) => node.props?.className?.split(' ').includes('sbm-detail'));
const setup = (overrides = {}, options = {}) => { api.configure(options); hooks.seed(state(overrides)); return tree(); };
const tick = () => new Promise((resolve) => setImmediate(resolve));
const timers = (t) => {
  const timeouts = []; const intervals = []; const cleared = [];
  t.mock.method(globalThis, 'setTimeout', (fn, delay) => { timeouts.push({fn, delay}); return timeouts.length; });
  t.mock.method(globalThis, 'clearTimeout', (id) => { cleared.push(['timeout', id]); });
  t.mock.method(globalThis, 'setInterval', (fn, delay) => { intervals.push({fn, delay}); return intervals.length; });
  t.mock.method(globalThis, 'clearInterval', (id) => { cleared.push(['interval', id]); });
  return {timeouts, intervals, cleared};
};

test('all seven statuses keep the three simultaneous groups and initial selection priority', () => {
  const page = setup(); const html = htmlOf(page);
  for (const label of ['Currently Parked (2)', 'Arriving Soon (2)', 'History (3)']) assert.ok(textOf(page).includes(label));
  assert.equal(rows(page).length, 7); assert.equal(rows(page).find((row) => row.props['data-selected']).props['data-status'], 'ACTIVE');
  for (const status of ['ACTIVE', 'PAUSED', 'PENDING', 'PAID', 'COMPLETED', 'CANCELLED', 'EXPIRED']) assert.ok(html.includes(`data-status="${status}"`));
  assert.ok(!nodes(page).some((node) => node.props.role === 'tab'));
});
test('group sorting stays upcoming start ascending, active start descending, history end descending', () => {
  const data = [record('p-late', 'PENDING', '2026-10-25T04:00:00Z'), record('p-early', 'PAID', '2026-10-25T01:00:00Z'), record('a-early', 'ACTIVE', '2026-10-25T01:00:00Z'), record('a-late', 'PAUSED', '2026-10-25T04:00:00Z'), record('h-early', 'CANCELLED', undefined, '2026-10-25T01:00:00Z'), record('h-late', 'COMPLETED', undefined, '2026-10-25T04:00:00Z')];
  const page = setup({3: data});
  assert.deepEqual(rows(page).map((row) => row.key.replace(/^\.\$/, '')), ['a-late', 'a-early', 'p-early', 'p-late', 'h-late', 'h-early']);
});
test('selecting a row shows the original detail, all financial fields and matching selected style hook', () => {
  let page = setup(); rows(page).find((row) => row.key.replace(/^\.\$/, '') === 'cancelled').props.onClick(); page = tree();
  const html = htmlOf(detail(page)).replace(/<!--.*?-->/g, '');
  for (const label of ['51A-cancelled', 'CANCELLED', 'Internal Ref ID', 'Start Schedule', 'End Schedule', 'Driver cancelled', 'cancelled@example.test', '0912345678', 'Floor 1', 'Acancelled', 'Actual Revenue', 'Base Payment', 'Additional Charges', 'Refund Paid', 'Method', 'wallet', '3 Hours Total', 'Created At', 'Last Updated', '27.000', '25.000', '10.000', '8.000']) assert.ok(html.includes(label), label);
  assert.equal(rows(page).find((row) => row.key.replace(/^\.\$/, '') === 'cancelled').props['data-selected'], true);
});
test('identical API statistics preserve the four KPI labels, numbers, breakdown and scope metadata', () => {
  const html = htmlOf(setup());
  for (const text of ['Completed Gross Revenue', 'Cancelled Bookings', 'Completed Bookings', 'Actual Completed Revenue', '350.000', '300.000', '50.000', '330.000', '20.000', 'Excluded from all completed revenue totals', 'Synced', 'Data available']) assert.ok(html.includes(text), text);
});
test('search/floor filters keep their existing fields, counts and sticky selected detail behavior', () => {
  let page = setup(); rows(page).find((row) => row.key.replace(/^\.\$/, '') === 'cancelled').props.onClick();
  nodes(page).find((node) => node.type === 'input' && node.props.type === 'text').props.onChange({target: {value: 'Driver paid'}});
  page = tree(); assert.equal(rows(page).length, 1); assert.equal(rows(page)[0].key.replace(/^\.\$/, ''), 'paid');
  assert.ok(htmlOf(detail(page)).includes('Driver cancelled')); // Characterize existing selection outside the filter.
  setup({7: 'Apending'}); assert.equal(rows(tree())[0].key.replace(/^\.\$/, ''), 'pending');
  page = setup(); nodes(page).find((node) => node.props?.ariaLabel === 'Filter bookings by floor').props.onChange('floor-2');
  assert.equal(rows(tree()).length, 0); assert.ok(htmlOf(tree()).includes('No bookings found for this day.'));
});
test('date picker and previous/next handlers keep selected calendar-day changes', () => {
  let page = setup(); const initial = hooks.values()[1].getDate();
  const dateControl = nodes(page).find((node) => node.props?.className?.includes('sbm-date'));
  const controls = nodes(dateControl).filter((node) => node.type === 'button');
  controls[0].props.onClick(); assert.equal(hooks.values()[1].getDate(), initial - 1);
  page = tree(); const next = nodes(nodes(page).find((node) => node.props?.className?.includes('sbm-date'))).filter((node) => node.type === 'button')[1];
  next.props.onClick(); assert.equal(hooks.values()[1].getDate(), initial);
  nodes(page).find((node) => node.type === 'input' && node.props.type === 'date').props.onChange({target: {value: '2026-10-20'}});
  assert.equal(hooks.values()[1].getDate(), 20);
});
test('Daily and All time preserve statistics request scope and 30-second polling', async (t) => {
  const clock = timers(t);
  for (const [range, expected] of [['daily', {date: '2026-10-25', floorId: 'floor-1'}], ['all', {}]]) {
    setup({6: 'floor-1', 9: range}); const cleanup = hooks.pendingEffects()[4]();
    await clock.timeouts.at(-1).fn(); assert.deepEqual(api.calls.at(-1), ['statistics', range, expected]);
    assert.equal(clock.intervals.at(-1).delay, 30000); await clock.intervals.at(-1).fn(); cleanup();
  }
  let page = setup(); button(page, 'All time').props.onClick(); assert.equal(hooks.values()[9], 'all');
  page = tree(); button(page, 'Daily').props.onClick(); assert.equal(hooks.values()[9], 'daily');
});
test('Refresh only increments statistics refresh key and stays disabled during statistics loading', () => {
  let page = setup(); const refresh = nodes(page).find((node) => node.props?.title === 'Refresh booking statistics');
  refresh.props.onClick(); assert.equal(hooks.values()[13], 1); assert.equal(api.calls.length, 0);
  assert.deepEqual(hooks.values()[3], bookings);
  page = setup({11: true}); assert.equal(nodes(page).find((node) => node.props?.title === 'Refresh booking statistics').props.disabled, true);
});
test('list fetch keeps date-only query and two-source failure/reset behavior', async () => {
  setup({}, {floors: {ok: true, data: {success: true, data: floors}}, bookings: {ok: true, data: {success: true, data: bookings}}});
  hooks.pendingEffects()[3](); await tick();
  assert.deepEqual(api.calls, [['floors'], ['bookings', {date: '2026-10-25'}]]);
  assert.equal(hooks.values()[8], null); assert.deepEqual(hooks.values()[3], bookings);
  setup({}, {floors: {ok: false, data: {message: 'Floor failure'}}}); hooks.pendingEffects()[3](); await tick();
  assert.deepEqual(hooks.values()[3], []); assert.ok(hooks.values()[5].includes('Floor failure'));
});
test('statistics errors keep unavailable values; refresh preserves old statistics while pending', async (t) => {
  const clock = timers(t); setup({}, {statistics: {ok: false, data: {message: 'Stats failure'}}});
  hooks.pendingEffects()[4](); const pending = clock.timeouts.at(-1).fn();
  assert.equal(hooks.values()[10], statistics); assert.equal(hooks.values()[11], true); await pending;
  assert.equal(hooks.values()[10], null); assert.equal(hooks.values()[12], 'Stats failure');
  assert.ok(htmlOf(tree()).includes('Stats failure')); assert.ok(!htmlOf(tree()).includes('350.000'));
});
test('list loading/error/empty messages and original detail visibility classes remain intact', () => {
  for (const [overrides, expected] of [[{4: true}, 'Syncing bookings...'], [{5: 'Fixture failed'}, 'Booking data unavailable'], [{3: []}, 'No bookings found for this day.']]) {
    const page = setup(overrides); assert.ok(htmlOf(page).includes(expected));
    assert.ok(detail(page).props.className.includes('hidden md:flex'));
  }
});
test('overdue is display-only for ACTIVE and progress still uses the existing clock', () => {
  const expiredSchedule = record('overdue', 'ACTIVE', '2026-10-25T01:00:00Z', '2026-10-25T02:00:00Z');
  const page = setup({3: [expiredSchedule]}); assert.equal(rows(page)[0].props['data-status'], 'OVERDUE');
  assert.equal(module.getBookingDisplayStatus({...expiredSchedule, status: 'PAUSED'}, now), 'PAUSED');
  const html = htmlOf(React.createElement(module.ProgressBar, {start: expiredSchedule.scheduledStart, end: expiredSchedule.scheduledEnd, now}));
  assert.ok(html.includes('100%')); assert.ok(html.includes('Exceeded by 3h'));
});
test('existing-record deep link selects and clears query; missing-record envelope behavior is unchanged', async (t) => {
  const clock = timers(t); setup({}, {query: 'bookingId=cancelled'}); hooks.pendingEffects()[2](); clock.timeouts.at(-1).fn();
  assert.equal(hooks.values()[8]._id, 'cancelled'); assert.equal(hooks.values()[0], true); assert.deepEqual(api.queryChanges, [{}]);
  setup({}, {query: 'bookingId=not-in-list', bookings: {ok: true, data: {success: true, data: [record('not-in-list', 'PAID')]}}});
  hooks.pendingEffects()[2](); await tick();
  assert.deepEqual(api.calls[0], ['bookings', {bookingId: 'not-in-list'}]);
  assert.equal(hooks.values()[8], null); // Existing mismatched deep-link response access is deliberately not fixed.
});
test('missing customer/schedule/finance fallbacks retain original values without UI inventions', () => {
  const fallback = {...record('fallback', 'CANCELLED'), userId: null, floorId: null, financialSummary: undefined, paymentMethod: '', scheduledStart: null, scheduledEnd: null};
  const html = htmlOf(detail(setup({3: [fallback]})));
  for (const text of ['Guest User', 'Unknown Floor', 'N/A', '25.000', 'Wallet']) assert.ok(html.includes(text));
  assert.ok(!html.includes('Refund pending'));
});
test('new CSS is strictly role/page scoped and retains the mobile detail restriction', () => {
  const source = readFileSync(new URL('staffBookingManagement.css', import.meta.url), 'utf8');
  postcss.parse(source).walkRules((rule) => selectorParser((selectors) => selectors.each((selector) => {
    assert.ok(selector.toString().trim().startsWith('body[data-valo-typography="staff"] .staff-booking-management'), selector.toString());
  })).processSync(rule.selector));
  assert.ok(source.includes('prefers-reduced-motion: reduce'));
  assert.ok(source.includes('.sbm-detail { display: none; }'));
  assert.ok(!source.includes('.staff-dashboard-sidebar')); assert.ok(!source.includes('valo-ai'));
});


test('short History lists keep controls, selected detail and every existing field', () => {
  for (const count of [1, 2]) {
    const history = [record('history-one', 'CANCELLED'), record('history-two', 'COMPLETED')].slice(0, count);
    let page = setup({3: history});
    assert.equal(rows(page).length, count);
    assert.ok(nodes(page).some((node) => node.props?.className?.includes('sbm-controls')));
    assert.ok(textOf(page).includes(`History (${count})`));
    rows(page).at(-1).props.onClick(); page = tree();
    const html = htmlOf(detail(page));
    for (const label of ['Internal Ref ID', 'Start Schedule', 'End Schedule', 'Customer', 'Location', 'Actual Revenue', 'Base Payment', 'Additional Charges', 'Refund Paid', 'Method', 'Summary', 'Created At', 'Last Updated']) assert.ok(html.includes(label), label);
    assert.ok(html.includes(history.at(-1).userId.email));
  }
});
test('desktop detail cannot expand the controls track above History', () => {
  const css = postcss.parse(readFileSync(new URL('staffBookingManagement.css', import.meta.url), 'utf8'));
  const desktop = new Map();
  css.walkRules((rule) => {
    if (rule.parent.type !== 'atrule' || rule.parent.params !== '(min-width: 1280px)') return;
    const declarations = Object.fromEntries(rule.nodes.filter((node) => node.type === 'decl').map((node) => [node.prop, node.value]));
    desktop.set(rule.selector.trim(), declarations);
  });
  const root = 'body[data-valo-typography="staff"] .staff-booking-management';
  assert.equal(desktop.get(`${root} .sbm-controls`)['grid-row'], '3');
  assert.equal(desktop.get(`${root} .sbm-list`)['grid-row'], '4');
  assert.equal(desktop.get(`${root} .sbm-detail`)['grid-row'], '4');
  assert.equal(desktop.get(`${root} .sbm-list`)['grid-row'], desktop.get(`${root} .sbm-detail`)['grid-row']);
});
test('zero completed revenue and nonzero cancelled-booking revenue retain independent data scopes', () => {
  const cancelled = record('cancelled-financial', 'CANCELLED');
  cancelled.prepaidAmount = 1190000;
  cancelled.financialSummary = {prepaidCollected: 1190000, additionalCollected: 0, refundPaid: 0, actualRevenue: 1190000};
  const zeroStatistics = {...statistics, completed: {count: 0, grossRevenue: 0, prepaidRevenue: 0, additionalRevenue: 0, refundPaid: 0, actualRevenue: 0}};
  const page = setup({3: [cancelled], 10: zeroStatistics});
  const metrics = nodes(page).find((node) => node.props?.className?.includes('sbm-metric-strip'));
  const metricHtml = htmlOf(metrics);
  assert.ok(metricHtml.includes('Actual Completed Revenue')); assert.ok(!metricHtml.includes('1.190.000'));
  assert.ok(htmlOf(detail(page)).includes('1.190.000'));
  const actualMetric = nodes(metrics).find((node) => node.props?.label === 'Actual Completed Revenue');
  assert.ok(actualMetric.props.value.startsWith('0'));
});
