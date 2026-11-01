import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { readFileSync } from 'node:fs';
import postcss from 'postcss';
import { createServer } from 'vite';
let server, hooks, module;
let role = 'staff';
const storage = { local: globalThis.localStorage, session: globalThis.sessionStorage };
before(async () => {
  globalThis.localStorage = { getItem: () => 'fixture-token' };
  globalThis.sessionStorage = { getItem: () => JSON.stringify({ role }) };
  server = await createServer({ optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, hmr: false }, appType: 'custom', plugins: [{
    name: 'staff-subscription-pagination-fixture', enforce: 'pre',
    resolveId(id) { if (id.startsWith('virtual:subscription-pagination-')) return '\0' + id; },
    load(id) {
      if (id === '\0virtual:subscription-pagination-hooks') return `
        let states = [], cursor = 0, refs = [], refCursor = 0; export let effects = [];
        export const seed = values => { states = [...values]; refs = []; };
        export const begin = () => { cursor = 0; refCursor = 0; effects = []; };
        export const values = () => states;
        export const set = (index, value) => { states[index] = value; };
        export const useState = initial => { const index = cursor++; if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial; return [states[index], next => { states[index] = typeof next === 'function' ? next(states[index]) : next; }]; };
        export const useEffect = fn => { effects.push(fn); };
        export const useMemo = fn => fn(); export const useCallback = fn => fn;
        export const useRef = value => { const index = refCursor++; return refs[index] ||= { current: value }; };
      `;
      if (id === '\0virtual:subscription-pagination-router') return `export const useLocation = () => ({ pathname: '/staff/subscriptions', key: 'fixture' }); export const useSearchParams = () => [new URLSearchParams(), () => {}];`;
    },
    transform(source, id) {
      if (!id.replaceAll('\\', '/').endsWith('/pages/Admin/SubscriptionManagement.jsx')) return;
      return source.replace("from 'react'", "from 'virtual:subscription-pagination-hooks'").replace("from 'react-router-dom'", "from 'virtual:subscription-pagination-router'");
    },
  }] });
  hooks = await server.ssrLoadModule('virtual:subscription-pagination-hooks');
  module = await server.ssrLoadModule('/src/pages/Admin/SubscriptionManagement.jsx');
});
after(async () => { await server?.close(); globalThis.localStorage = storage.local; globalThis.sessionStorage = storage.session; });
const records = Array.from({ length: 19 }, (_, index) => ({
  _id: 'sub-' + index, status: index % 2 ? 'pending' : 'active',
  user: { username: 'Driver ' + index, email: `driver${index}@example.test`, vehicles: [] },
  ticketPackage: { name: index % 2 ? 'Monthly' : 'Yearly', type: index % 2 ? 'monthly' : 'yearly' },
  expireAt: '2027-01-01T00:00:00Z', amount: 50000,
}));
const seed = (page = 1, data = records) => { role = 'staff'; hooks.seed([data, false, '', '', false, '', 'all', 'all', [], { status: 'loading' }, page]); };
const render = () => { hooks.begin(); return module.default(); };
const nodes = node => !node || typeof node !== 'object' ? [] : [node, ...React.Children.toArray(node.props?.children).flatMap(nodes)];
const text = node => typeof node === 'object' ? React.Children.toArray(node?.props?.children).map(text).join('') : String(node ?? '');
const rows = page => nodes(page).filter(node => typeof node.type === 'function' && node.type.name === 'MembershipRow');
const button = (page, label) => nodes(page).find(node => node.type === 'button' && text(node) === label);
test('Staff paginates the full filtered source into six-row pages and exact totals', () => {
  seed(); let page = render();
  assert.equal(rows(page).length, 6); assert.ok(text(page).includes('Page 1 of 4'));
  assert.ok(text(page).includes('19 results')); assert.equal(button(page, 'Prev').props.disabled, true);
  button(page, 'Next').props.onClick(); page = render();
  assert.deepEqual(rows(page).map(row => row.props.sub._id), records.slice(6, 12).map(row => row._id));
  button(page, '4').props.onClick(); page = render();
  assert.deepEqual(rows(page).map(row => row.props.sub._id), ['sub-18']);
  assert.equal(button(page, 'Next').props.disabled, true);
  button(page, 'Prev').props.onClick(); assert.ok(text(render()).includes('Page 3 of 4'));
});
test('search and both filters reset to page one and apply before slicing', () => {
  seed(4); let page = render();
  nodes(page).find(node => node.type === 'input').props.onChange({ target: { value: 'Driver 1' } });
  page = render(); assert.ok(text(page).includes('Page 1 of 2')); assert.ok(text(page).includes('10 results'));
  assert.equal(rows(page).length, 6);
  button(page, 'Next').props.onClick(); page = render();
  nodes(page).find(node => node.props?.ariaLabel === 'Filter subscriptions by status').props.onChange('active');
  page = render(); assert.ok(text(page).includes('Page 1 of 1')); assert.equal(rows(page).length, 5);
  nodes(page).find(node => node.props?.ariaLabel === 'Filter subscriptions by package').props.onChange('monthly');
  page = render(); assert.equal(rows(page).length, 0); assert.ok(text(page).includes('0 results'));
  assert.equal(button(page, 'Prev').props.disabled, true); assert.equal(button(page, 'Next').props.disabled, true);
  button(page, 'Clear filters').props.onClick(); page = render();
  assert.ok(text(page).includes('Page 1 of 4')); assert.equal(rows(page).length, 6);
});
test('data shrink clamps immediately and persists the valid page without changing Refresh state', t => {
  seed(4); render(); hooks.set(0, records.slice(0, 8));
  let page = render(); assert.ok(text(page).includes('Page 2 of 2')); assert.equal(rows(page).length, 2);
  let scheduled; t.mock.method(globalThis, 'setTimeout', fn => { scheduled = fn; return 1; });
  hooks.effects[1](); scheduled(); assert.equal(hooks.values()[10], 2);
  hooks.set(0, records); page = render(); assert.ok(text(page).includes('Page 2 of 4'));
  hooks.set(1, true); page = render(); assert.equal(button(page, 'Next').props.disabled, true);
  assert.equal(button(page, 'Refresh').props.disabled, true);
});
test('page navigation resets only the membership list scroll; CSS fixes surrounding sections', () => {
  seed(2); const page = render();
  const scroller = nodes(page).find(node => node.props?.className === 'staff-membership-scroll');
  scroller.props.ref.current = { scrollTop: 300 }; hooks.effects[2]();
  assert.equal(scroller.props.ref.current.scrollTop, 0);
  const css = readFileSync(new URL('./staffSubscriptionsPagination.css', import.meta.url), 'utf8');
  postcss.parse(css).walkRules(rule => assert.ok(rule.selector.startsWith('body[data-valo-typography="staff"] .g3-vip-page')));
  for (const expected of ['height: calc(100dvh - 70px)', 'overflow-y: auto', 'scrollbar-width: none', 'display: none', 'min-height: 0']) assert.ok(css.includes(expected));
  assert.ok(!css.includes('.g3-membership-row')); assert.ok(!css.includes('.g3-header-action'));
});
test('Admin remains unpaginated and keeps its original Refresh control', () => {
  seed(); role = 'admin'; const page = render();
  assert.equal(rows(page).length, 19);
  assert.ok(!nodes(page).some(node => node.props?.['aria-label'] === 'Membership pages'));
  assert.ok(button(page, 'Refresh')); role = 'staff';
});
