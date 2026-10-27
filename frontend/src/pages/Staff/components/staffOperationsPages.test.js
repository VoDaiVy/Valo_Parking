import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setImmediate } from 'node:timers';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import postcss from 'postcss';
import selectorParser from 'postcss-selector-parser';

// Isolated hook runner: execute the real JSX handlers with mocked APIs, never a network.
// Private components are exported only by this test's Vite transform.
let server; let hooks; let api; let tickets; let notifications;
const originalStorage = { local: globalThis.localStorage, session: globalThis.sessionStorage };
let userRole = 'staff';
before(async () => {
  globalThis.localStorage = { getItem: () => 'fixture-token' };
  globalThis.sessionStorage = { getItem: () => JSON.stringify({ role: userRole }) };
  server = await createServer({
    optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, hmr: false }, appType: 'custom',
    plugins: [{
      name: 'isolated-staff-operations', enforce: 'pre',
      resolveId(id) { if (id.startsWith('virtual:operations-')) return `\0${id}`; },
      load(id) {
        if (id === '\0virtual:operations-hooks') return `
          let states = [], refs = [], cursor = 0, refCursor = 0, effects = [];
          export const seed = (next) => { states = [...next]; refs = []; cursor = 0; refCursor = 0; effects = []; };
          export const begin = () => { cursor = 0; refCursor = 0; effects = []; };
          export const values = () => states;
          export const pendingEffects = () => effects;
          export const useState = (initial) => {
            const key = cursor++;
            if (!(key in states)) states[key] = typeof initial === 'function' ? initial() : initial;
            return [states[key], (next) => { states[key] = typeof next === 'function' ? next(states[key]) : next; }];
          };
          export const useRef = (value) => { const key = refCursor++; return refs[key] ||= { current: value }; };
          export const useEffect = (effect) => { effects.push(effect); };
          export const useMemo = (fn) => fn();
          export const useCallback = (fn) => fn;
        `;
        if (id === '\0virtual:operations-api') return `
          export const calls = [];
          let sendResponse, historyResponse, userResponse;
          export const reset = () => {
            calls.length = 0;
            sendResponse = {ok: true, data: {message: 'Notification sent'}};
            historyResponse = {ok: true, data: {success: true, data: [], pagination: {total: 0, totalPages: 1}, stats: {totalSent: 0, success: 0, errors: 0}}};
            userResponse = {ok: true, data: {success: true, data: []}};
          };
          export const setSend = (response) => { sendResponse = response; };
          export const setHistory = (response) => { historyResponse = response; };
          export const setUsers = (response) => { userResponse = response; };
          export const createNotification = async (payload) => { calls.push(['send', payload]); return await sendResponse; };
          export const getAdminHistory = async (query) => { calls.push(['history', query]); return await historyResponse; };
          export const searchUsers = async (query) => { calls.push(['users', query]); return await userResponse; };
        `;
      },
      transform(source, id) {
        const path = id.replaceAll('\\', '/');
        if (!/\/pages\/(Admin\/TicketPackages|Staff\/NotificationManagement)\.jsx$/.test(path)) return;
        let result = source.replace(/from ['"]react['"]/, "from 'virtual:operations-hooks'");
        if (path.endsWith('/NotificationManagement.jsx')) {
          result = result.replace(/from "\.\.\/\.\.\/services\/(notificationService|userService)"/g, "from 'virtual:operations-api'");
          result += '\nexport { ComposeTab, UserPicker, FeedTab, StatsRow, LiveBadge, MessageRow };';
        } else result += '\nexport { PackageRow };';
        return result;
      },
    }],
  });
  hooks = await server.ssrLoadModule('virtual:operations-hooks');
  api = await server.ssrLoadModule('virtual:operations-api');
  tickets = await server.ssrLoadModule('/src/pages/Admin/TicketPackages.jsx');
  notifications = await server.ssrLoadModule('/src/pages/Staff/NotificationManagement.jsx');
});
after(async () => {
  await server?.close();
  globalThis.localStorage = originalStorage.local;
  globalThis.sessionStorage = originalStorage.session;
});
const tree = (Component, props = {}) => { hooks.begin(); return Component(props); };
const htmlOf = (node) => renderToStaticMarkup(node);
const textOf = (node) => {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node !== 'object') return String(node);
  return React.Children.toArray(node.props?.children).map(textOf).join('');
};
const nodes = (node) => !node || typeof node !== 'object' ? [] : [node, ...React.Children.toArray(node.props?.children).flatMap(nodes)];
const button = (node, text) => nodes(node).find((item) => item.type === 'button' && textOf(item).includes(text));
const sendButton = (node) => nodes(node).find((item) => item.props?.className?.includes('snm-send'));
const rowMessages = (node) => nodes(node).filter((item) => item.type === notifications.MessageRow);
const packages = [
  {_id: 'hour', name: 'Standard Hourly', description: 'Short visits', type: 'hourly', price: 10000, isActive: true, updatedAt: '2026-10-20T08:00:00Z'},
  {_id: 'month', name: 'Premium Monthly', description: 'Reserved access', type: 'monthly', price: 500000, isActive: false, updatedAt: '2026-10-22T08:00:00Z'},
  {_id: 'daily', name: 'Daily', type: 'daily', price: 50000, isActive: true},
];
const ticketState = (overrides = {}) => Object.assign([packages, false, '', '', '', 'all', 'all', false, {isOpen: false, packageId: null}, null, {name: '', type: 'hourly', price: '', description: '', isActive: true}], overrides);
const users = [{_id: 'user-1', username: 'driver', email: 'driver@example.test', role: 'customer'}, {_id: 'user-2', username: 'operator', email: 'operator@example.test', role: 'staff'}];
const composeState = (overrides = {}) => Object.assign(['single', [], ['customer'], '', '', 'INFO', null, false], overrides);
const liveState = {status: 'live', isAvailable: true, error: ''};
const selectionCss = () => postcss.parse(readFileSync(new URL('staffNotificationManagement.css', import.meta.url), 'utf8'));
const mockGlobal = (t, key, value) => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, key);
  Object.defineProperty(globalThis, key, {value, configurable: true, writable: true});
  t.after(() => { if (previous) Object.defineProperty(globalThis, key, previous); else delete globalThis[key]; });
};
const feedProps = (overrides = {}) => ({notifications: [], loading: false, loadingMore: false, error: '', state: liveState, hasMore: false, total: 0, onLoadMore() {}, onRefresh() {}, ...overrides});
const message = (priority = 'INFO', extra = {}) => ({_id: priority, title: `${priority} event`, content: 'Parking update', priority, type: 'SYSTEM', targetType: 'ALL_USERS', createdAt: '2026-10-20T08:00:00Z', ...extra});

// Packages: execute existing filters and Admin actions without submitting any request.
test('Staff package catalog keeps three metrics, VND prices and no CRUD or row navigation', () => {
  userRole = 'staff'; hooks.seed(ticketState());
  const page = tree(tickets.default); const html = htmlOf(page);
  for (const label of ['Total Packages', 'Active Packages', 'Last Updated', '10.000 VND', '500.000 VND', 'Hourly', 'Monthly', 'Daily', 'Active', 'Inactive']) assert.ok(html.includes(label), label);
  assert.equal(nodes(page).filter((node) => node.type === tickets.PackageRow).length, 3);
  assert.ok(!html.includes('Add Package')); assert.ok(!html.includes('aria-label="Edit')); assert.ok(!html.includes('View Details'));
  const row = tickets.PackageRow({pkg: packages[0], isAdmin: false, index: 0});
  assert.equal(row.type, 'article'); assert.equal(row.props.onClick, undefined);
});
test('package search, type and status filters preserve semantics and KPI totals', () => {
  userRole = 'staff'; hooks.seed(ticketState());
  let page = tree(tickets.default);
  nodes(page).find((node) => node.type === 'input' && node.props.type === 'search').props.onChange({target: {value: 'Reserved access'}});
  page = tree(tickets.default); assert.equal(nodes(page).filter((node) => node.type === tickets.PackageRow).length, 1);
  assert.ok(htmlOf(page).includes('Total Packages'));
  nodes(page).find((node) => node.props?.['aria-label'] === 'Clear package search').props.onClick();
  page = tree(tickets.default);
  nodes(page).find((node) => node.props?.ariaLabel === 'Filter packages by type').props.onChange('monthly');
  page = tree(tickets.default); assert.equal(nodes(page).find((node) => node.type === tickets.PackageRow).props.pkg._id, 'month');
  nodes(page).find((node) => node.props?.ariaLabel === 'Filter packages by status').props.onChange('active');
  assert.ok(htmlOf(tree(tickets.default)).includes('No matching packages'));
});
test('Admin still renders create/edit/delete, modal fields and destructive confirmation', () => {
  userRole = 'admin'; hooks.seed(ticketState());
  let page = tree(tickets.default); assert.ok(htmlOf(page).includes('Add Package'));
  button(page, 'Add Package').props.onClick(); page = tree(tickets.default);
  for (const label of ['Create Package', 'Package Name', 'Price (VND)', 'Description', 'Active Package', 'Save Package', 'Cancel']) assert.ok(htmlOf(page).includes(label));
  hooks.seed(ticketState()); page = tree(tickets.default);
  const row = nodes(page).find((node) => node.type === tickets.PackageRow);
  const rowTree = tickets.PackageRow(row.props);
  nodes(rowTree).find((node) => node.props?.['aria-label'] === 'Edit Standard Hourly').props.onClick();
  page = tree(tickets.default); assert.ok(htmlOf(page).includes('Edit Package'));
  assert.equal(nodes(page).find((node) => node.type === 'input' && node.props.type === 'text').props.value, 'Standard Hourly');
  nodes(rowTree).find((node) => node.props?.['aria-label'] === 'Delete Standard Hourly').props.onClick();
  assert.ok(htmlOf(tree(tickets.default)).includes('Are you sure you want to delete this package?'));
  userRole = 'staff';
});
test('package skeleton, empty and API error states remain present', () => {
  for (const [states, expected] of [[ticketState({0: [], 1: true}), 'stp-skeleton'], [ticketState({0: []}), 'No ticket packages yet'], [ticketState({0: [], 2: 'Fixture unavailable'}), 'Ticket package data unavailable']]) {
    hooks.seed(states); assert.ok(htmlOf(tree(tickets.default)).includes(expected));
  }
});

// Compose: actual event closures, local state updates, validation and async send.
test('four audiences, five priorities, limits and blank-form disabled state render', () => {
  hooks.seed(composeState());
  const page = tree(notifications.ComposeTab, {onSent() {}}); const html = htmlOf(page);
  for (const label of ['One user', 'Multiple users', 'By role', 'Entire system', 'INFO', 'SUCCESS', 'WARNING', 'ERROR', 'SYSTEM', 'Preview']) assert.ok(html.includes(label));
  assert.equal(sendButton(page).props.disabled, true);
  assert.equal(nodes(page).find((node) => node.type === 'input').props.maxLength, 200);
  assert.equal(nodes(page).find((node) => node.type === 'textarea').props.maxLength, 2000);
});
test('audience switches retain single first user and clear selected users for role/all', () => {
  hooks.seed(composeState({0: 'multi', 1: users}));
  button(tree(notifications.ComposeTab, {}), 'One user').props.onClick();
  assert.deepEqual(hooks.values()[1], [users[0]]);
  button(tree(notifications.ComposeTab, {}), 'By role').props.onClick(); assert.deepEqual(hooks.values()[1], []);
  let page = tree(notifications.ComposeTab, {});
  button(page, 'customer').props.onClick(); assert.deepEqual(hooks.values()[2], []);
  page = tree(notifications.ComposeTab, {}); button(page, 'staff').props.onClick(); assert.deepEqual(hooks.values()[2], ['staff']);
  button(tree(notifications.ComposeTab, {}), 'Entire system').props.onClick();
  assert.deepEqual(hooks.values()[1], []); assert.ok(htmlOf(tree(notifications.ComposeTab, {})).includes('System-wide delivery'));
});
test('title/content edits and priority selection update multiline preview and ready state', () => {
  hooks.seed(composeState({0: 'all'})); let page = tree(notifications.ComposeTab, {});
  nodes(page).find((node) => node.type === 'input').props.onChange({target: {value: '  Planned maintenance  '}});
  nodes(page).find((node) => node.type === 'textarea').props.onChange({target: {value: 'Line one\nLine two'}});
  page = tree(notifications.ComposeTab, {}); button(page, 'WARNING').props.onClick();
  page = tree(notifications.ComposeTab, {}); assert.equal(sendButton(page).props.disabled, false);
  const preview = nodes(page).find((node) => node.props?.className?.includes('snm-preview '));
  const html = htmlOf(preview); assert.ok(html.includes('Planned maintenance')); assert.ok(html.includes('Line one\nLine two')); assert.ok(html.includes('whitespace-pre-wrap')); assert.ok(html.includes('WARNING'));
});
test('invalid audience and whitespace-only fields block submission with existing feedback', async () => {
  for (const [states, expected] of [[composeState({3: 'Title', 4: 'Message'}), 'Please select a user.'], [composeState({0: 'multi', 1: [users[0]], 3: 'Title', 4: 'Message'}), 'at least two'], [composeState({0: 'role', 2: [], 3: 'Title', 4: 'Message'}), 'at least one role'], [composeState({0: 'all', 3: '   ', 4: 'Message'}), 'Title and content are required']]) {
    api.reset(); hooks.seed(states); const page = tree(notifications.ComposeTab, {});
    assert.equal(sendButton(page).props.disabled, true);
    await sendButton(page).props.onClick(); assert.equal(api.calls.length, 0);
    assert.ok(htmlOf(tree(notifications.ComposeTab, {})).includes(expected));
  }
});
test('all four audiences preserve trimmed payload and one-second success transition', async (t) => {
  const scheduled = []; t.mock.method(globalThis, 'setTimeout', (fn, delay) => { scheduled.push({fn, delay}); return 1; });
  for (const [audience, selected, roles, type] of [['single', [users[0]], ['customer'], 'SINGLE_USER'], ['multi', users, ['customer'], 'MULTI_USER'], ['role', [], ['staff', 'customer'], 'ROLE_BASED'], ['all', [], ['customer'], 'ALL_USERS']]) {
    api.reset(); hooks.seed(composeState({0: audience, 1: selected, 2: roles, 3: '  Title  ', 4: '  Message  ', 5: 'SYSTEM'})); let sent = 0;
    const props = {onSent: () => sent++}; await sendButton(tree(notifications.ComposeTab, props)).props.onClick();
    assert.deepEqual(api.calls[0], ['send', {title: 'Title', content: 'Message', type: 'SYSTEM', priority: 'SYSTEM', targetType: type, targetUsers: selected.map((user) => user._id), ...(type === 'ROLE_BASED' ? {targetRoles: roles} : {})}]);
    assert.equal(sent, 0); assert.equal(scheduled.at(-1).delay, 1000); scheduled.at(-1).fn(); assert.equal(sent, 1);
    assert.ok(htmlOf(tree(notifications.ComposeTab, props)).includes('Notification sent'));
  }
});
test('pending send disables the button; API failure and thrown connection keep compose feedback', async () => {
  api.reset(); let resolveSend; api.setSend(new Promise((resolve) => { resolveSend = resolve; }));
  hooks.seed(composeState({0: 'all', 3: 'Title', 4: 'Message'}));
  const pending = sendButton(tree(notifications.ComposeTab, {})).props.onClick();
  let page = tree(notifications.ComposeTab, {}); assert.equal(sendButton(page).props.disabled, true); assert.ok(htmlOf(page).includes('Sending...'));
  resolveSend({ok: false, data: {message: 'Fixture denied'}}); await pending;
  assert.ok(htmlOf(tree(notifications.ComposeTab, {})).includes('API error: Fixture denied'));
  api.setSend({then(resolve, reject) { reject(new Error('offline')); }});
  await sendButton(tree(notifications.ComposeTab, {})).props.onClick();
  assert.ok(htmlOf(tree(notifications.ComposeTab, {})).includes('API connection error'));
});
test('picker executes single replacement, multi toggle, chip removal, clear and search edit', () => {
  for (const multi of [false, true]) {
    hooks.seed(['', users, false, '']); let selected = [users[0]];
    const props = {multi, value: selected, onChange: (next) => { selected = next; }};
    let page = tree(notifications.UserPicker, props);
    button(page, 'operator').props.onClick(); assert.deepEqual(selected, multi ? users : [users[1]]);
    page = tree(notifications.UserPicker, {...props, value: selected});
    if (multi) { button(page, 'driverdriver@example.test').props.onClick(); assert.deepEqual(selected, [users[1]]); }
    page = tree(notifications.UserPicker, {...props, value: selected});
    nodes(page).find((node) => node.props?.['aria-label'] === 'Remove operator').props.onClick(); assert.deepEqual(selected, []);
    page = tree(notifications.UserPicker, {...props, value: users});
    if (multi) { button(page, 'Clear').props.onClick(); assert.deepEqual(selected, []); }
    nodes(page).find((node) => node.type === 'input').props.onChange({target: {value: 'driver'}}); assert.equal(hooks.values()[0], 'driver');
    page = tree(notifications.UserPicker, props); nodes(page).find((node) => node.props?.['aria-label'] === 'Clear search').props.onClick(); assert.equal(hooks.values()[0], '');
  }
});
test('picker debounce, async search, failure and effect cleanup use the original flow', async (t) => {
  const scheduled = []; const cancelled = []; t.mock.method(globalThis, 'setTimeout', (fn, delay) => { scheduled.push({fn, delay}); return scheduled.length; });
  t.mock.method(globalThis, 'clearTimeout', (id) => cancelled.push(id));
  api.reset(); api.setUsers({ok: true, data: {success: true, data: users}}); hooks.seed(['driver', [], false, '']);
  tree(notifications.UserPicker, {multi: false, value: [], onChange() {}});
  const cleanup = hooks.pendingEffects()[0](); assert.equal(scheduled[0].delay, 300); await scheduled[0].fn();
  assert.deepEqual(api.calls[0], ['users', 'driver']); assert.deepEqual(hooks.values()[1], users); cleanup(); assert.deepEqual(cancelled, [1]);
  api.setUsers({ok: false, data: {message: 'Search failed'}}); tree(notifications.UserPicker, {multi: false, value: [], onChange() {}});
  hooks.pendingEffects()[0](); await scheduled.at(-1).fn();
  assert.ok(htmlOf(tree(notifications.UserPicker, {multi: false, value: [], onChange() {}})).includes('Search failed'));
});

test('feed keeps local priority/search filters, rows, metadata and refresh', () => {
  const events = ['INFO', 'SUCCESS', 'WARNING', 'ERROR', 'SYSTEM'].map((priority) => message(priority)); let refreshed = 0;
  hooks.seed(['ALL', '']); const props = feedProps({notifications: events, total: 100, onRefresh: () => refreshed++});
  let page = tree(notifications.FeedTab, props); assert.equal(rowMessages(page).length, 5);
  nodes(page).find((node) => node.props?.label === 'WARNING').props.onClick();
  page = tree(notifications.FeedTab, props); assert.equal(rowMessages(page).length, 1); assert.equal(rowMessages(page)[0].props.m.priority, 'WARNING');
  nodes(page).find((node) => node.props?.label === 'All').props.onClick(); page = tree(notifications.FeedTab, props);
  nodes(page).find((node) => node.type === 'input').props.onChange({target: {value: 'success event'}});
  page = tree(notifications.FeedTab, props); assert.equal(rowMessages(page).length, 1);
  button(page, 'Refresh').props.onClick(); assert.equal(refreshed, 1);
  const html = htmlOf(page); for (const text of ['SUCCESS event', 'Parking update', 'Whole system', 'SENT', '1 shown']) assert.ok(html.includes(text));
  const row = notifications.MessageRow({m: message()}); assert.equal(row.type, 'li'); assert.equal(row.props.onClick, undefined);
});
test('feed retains loading, empty, error, loading-more and end-of-list states', () => {
  for (const [overrides, expected] of [[{loading: true}, 'Loading history from API'], [{}, 'No matching notifications'], [{error: 'Fixture error'}, 'Notification history unavailable'], [{loadingMore: true}, 'Loading older notifications'], [{notifications: [message()]}, 'All notifications have been loaded']]) {
    hooks.seed(['ALL', '']); assert.ok(htmlOf(tree(notifications.FeedTab, feedProps(overrides))).includes(expected));
  }
});
test('IntersectionObserver still requests the next page and disconnects on cleanup', (t) => {
  let callback; let observed; let disconnected = false; let loads = 0;
  mockGlobal(t, 'IntersectionObserver', class { constructor(fn, options) { callback = fn; assert.equal(options.rootMargin, '240px 0px'); } observe(target) { observed = target; } disconnect() { disconnected = true; } });
  hooks.seed(['ALL', '']); const page = tree(notifications.FeedTab, feedProps({hasMore: true, onLoadMore: () => loads++}));
  nodes(page).find((node) => node.props?.ref)?.props.ref && (nodes(page).find((node) => node.props?.ref).props.ref.current = 'sentinel');
  const cleanup = hooks.pendingEffects()[0](); assert.equal(observed, 'sentinel'); callback([{isIntersecting: true}]); assert.equal(loads, 1); cleanup(); assert.equal(disconnected, true);
});
test('history initial load, pagination deduplication, API stats and refresh retain existing requests', async (t) => {
  const timers = []; mockGlobal(t, 'window', {setTimeout: (fn) => { timers.push(fn); return 1; }, clearTimeout() {}});
  api.reset(); hooks.seed(['feed', [], true, false, '', 1, true, 0, {totalSent: 0, success: 0, errors: 0}]);
  tree(notifications.default); hooks.pendingEffects()[0]();
  api.setHistory({ok: true, data: {success: true, data: [message()], pagination: {total: 3, totalPages: 2}, stats: {totalSent: 3, success: 2, errors: 1}}});
  await timers[0](); await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(api.calls[0], ['history', {page: 1, limit: 50}]); assert.deepEqual(hooks.values()[8], {totalSent: 3, success: 2, errors: 1});
  let page = tree(notifications.default); let feed = nodes(page).find((node) => node.type === notifications.FeedTab);
  api.setHistory({ok: true, data: {success: true, data: [message(), message('ERROR')], pagination: {total: 3, totalPages: 2}, stats: {totalSent: 3, success: 2, errors: 1}}});
  feed.props.onLoadMore(); await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(api.calls.at(-1), ['history', {page: 2, limit: 50}]); assert.equal(hooks.values()[1].length, 2); assert.equal(hooks.values()[6], false);
  page = tree(notifications.default); feed = nodes(page).find((node) => node.type === notifications.FeedTab); feed.props.onRefresh(); await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(api.calls.at(-1), ['history', {page: 1, limit: 50}]);
  page = tree(notifications.default); button(page, 'Send Notification').props.onClick(); page = tree(notifications.default); assert.ok(nodes(page).some((node) => node.type === notifications.ComposeTab));
  button(page, 'Live Feed').props.onClick(); page = tree(notifications.default); assert.ok(!nodes(page).some((node) => node.type === notifications.ComposeTab));
});
test('API stats remain API values; both live and unavailable badges remain accurate', () => {
  const stats = htmlOf(notifications.StatsRow({stats: {totalSent: 123, success: 100, errors: 23}, state: liveState}));
  for (const value of ['123', '100', '23', 'Sent Successfully']) assert.ok(stats.includes(value));
  assert.ok(!stats.includes('%'));
  for (const status of ['live', 'loading', 'unavailable']) {
    const html = htmlOf(notifications.LiveBadge({state: {status}}));
    assert.ok(html.includes(status === 'live' ? 'API available' : status === 'loading' ? 'Loading API' : 'API unavailable'));
    if (status === 'live') assert.ok(html.includes('snm-api-original')); // Original Admin label retained; Staff CSS switches labels.
  }
});
test('all new CSS is Staff/page scoped; package desktop columns match and motion is optional', () => {
  for (const [file, root] of [['staffTicketPackages.css', '.staff-ticket-packages'], ['staffNotificationManagement.css', '.staff-notification-management']]) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8');
    const css = postcss.parse(source);
    css.walkRules((rule) => selectorParser((selectors) => selectors.each((selector) => {
      assert.ok(selector.toString().trim().startsWith(`body[data-valo-typography="staff"] ${root}`), selector.toString());
    })).processSync(rule.selector));
    assert.ok(source.includes('prefers-reduced-motion: reduce'));
    assert.ok(source.includes('#080B0F')); assert.ok(!source.includes('!important'));
  }
  const catalog = readFileSync(new URL('staffTicketPackages.css', import.meta.url), 'utf8');
  assert.ok(catalog.includes('.stp-columns, body[data-valo-typography="staff"] .staff-ticket-packages .stp-row-grid { grid-template-columns: minmax(180px,1.5fr) 100px minmax(125px,.8fr) 100px 140px; }'));
});


test('all audience and recipient labels expose explicit nested selection targets without changing role values', () => {
  for (const audience of ['single', 'multi', 'role', 'all']) {
    hooks.seed(composeState({0: audience}));
    const options = nodes(tree(notifications.ComposeTab, {})).filter((node) => node.props?.className?.includes('snm-audience-option'));
    assert.equal(options.length, 4);
    assert.equal(options.filter((node) => node.props['aria-pressed']).length, 1);
    for (const option of options) for (const hook of ['snm-audience-title', 'snm-audience-description', 'snm-audience-icon', 'snm-audience-check']) {
      assert.ok(nodes(option).some((node) => node.props?.className?.split(' ').includes(hook)));
    }
  }
  const recipients = [...users, {_id: 'admin-1', username: 'administrator', email: 'admin@example.test', role: 'admin'}];
  hooks.seed(['', recipients, false, '']);
  const page = tree(notifications.UserPicker, {multi: true, value: [users[0]], onChange() {}});
  const roles = nodes(page).filter((node) => node.props?.className?.includes('snm-recipient-role'));
  assert.deepEqual(roles.map((node) => node.props['data-role']), ['customer', 'staff', 'admin']);
  assert.ok(nodes(page).some((node) => node.props?.className?.includes('snm-recipient-chip')));
});
test('Staff CSS overrides nested gold labels directly and preserves semantic priorities and warnings', () => {
  const css = selectionCss();
  const declaration = (ending, property = 'color') => {
    let result;
    css.walkRules((rule) => {
      if (rule.selector.endsWith(ending)) rule.walkDecls(property, (decl) => { result = decl.value; });
    });
    return result;
  };
  // Parent color cannot override a nested legacy gold utility: target the labels themselves.
  for (const [ending, expected] of [
    ['.snm-audience-option .snm-audience-title', '#F5F7FA'],
    ['.snm-audience-option[aria-pressed="true"] .snm-audience-title', '#6EE7B7'],
    ['.snm-audience-option .snm-audience-description', '#9AADC0'],
    ['.snm-audience-option[aria-pressed="true"] .snm-audience-icon', '#6EE7B7'],
    ['.snm-audience-option[aria-pressed="true"] .snm-audience-check', '#6EE7B7'],
    ['.snm-user-picker .snm-recipient-name', '#F5F7FA'],
    ['.snm-recipient-option[aria-pressed="true"] .snm-recipient-name', '#6EE7B7'],
    ['.snm-user-picker .snm-recipient-email', '#9AADC0'],
    ['.snm-recipient-option[aria-pressed="true"] .snm-recipient-avatar', '#6EE7B7'],
    ['.snm-recipient-option[aria-pressed="true"] .snm-recipient-check', '#6EE7B7'],
    ['.snm-user-picker .snm-recipient-chip', '#6EE7B7'],
    ['.snm-recipient-chip button:hover', '#F5F7FA'],
    ['.snm-recipient-role[data-role="admin"]', '#C4B5E0'],
    ['.snm-recipient-role[data-role="staff"]', '#67D7E5'],
    ['.snm-recipient-role[data-role="customer"]', '#A6C8BC'],
  ]) assert.equal(declaration(ending), expected, ending);
  assert.equal(declaration('.snm-compose :is(input, textarea):focus', 'border-color'), '#10B98180');
  assert.equal(declaration('.snm-compose .snm-system-warning', 'border-color'), '#F59E0B40');
  assert.equal(declaration('.snm-compose button[aria-pressed="true"] > .snm-role-check', 'border-color'), '#10B98180');
  assert.equal(declaration('.snm-compose button[aria-pressed="true"] > .snm-role-check'), '#6EE7B7');
  hooks.seed(composeState({0: 'role'}));
  const rolePage = tree(notifications.ComposeTab, {});
  const customerCheck = nodes(button(rolePage, 'customer')).find((node) => node.props?.className?.includes('snm-role-check'));
  assert.ok(customerCheck);
  for (const [priority, color] of [['INFO', '#67D7E5'], ['SUCCESS', '#54E3B0'], ['WARNING', '#E7C278'], ['ERROR', '#F2A5AF'], ['SYSTEM', '#C4A7F5']]) {
    assert.equal(declaration(`[data-priority="${priority}"]`, '--event-color'), color);
  }
  assert.equal(declaration('.snm-compose button[data-priority][aria-pressed="true"]'), 'var(--event-color)');
});
