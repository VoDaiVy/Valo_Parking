import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { format } from 'date-fns';
import { createServer } from 'vite';
let server, hooks, module;
before(async () => {
  server = await createServer({ optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, hmr: false }, appType: 'custom', plugins: [{
    name: 'isolated-booking-calendar', enforce: 'pre',
    resolveId(id) { if (id === 'virtual:calendar-hooks') return '\0calendar-hooks'; },
    load(id) { if (id === '\0calendar-hooks') return `
      let values = [], cursor = 0; export let effects = [];
      export const reset = () => { values = []; cursor = 0; effects = []; };
      export const begin = () => { cursor = 0; effects = []; };
      export const useState = initial => { const index = cursor++; if (!(index in values)) values[index] = typeof initial === 'function' ? initial() : initial; return [values[index], next => { values[index] = typeof next === 'function' ? next(values[index]) : next; }]; };
      export const useEffect = fn => { effects.push(fn); };
      export const useRef = value => ({ current: value });
    `; },
    transform(source, id) {
      if (!id.replaceAll('\\', '/').endsWith('/components/BookingDatePicker.jsx')) return;
      return source.replace("from 'react'", "from 'virtual:calendar-hooks'") + '\nexport { BookingCalendar };';
    },
  }] });
  hooks = await server.ssrLoadModule('virtual:calendar-hooks');
  module = await server.ssrLoadModule('/src/pages/Staff/components/BookingDatePicker.jsx');
});
after(async () => { await server?.close(); });
const elements = node => !node || typeof node !== 'object' ? [] : [node, ...React.Children.toArray(node.props?.children).flatMap(elements)];
const labeled = (tree, label) => elements(tree).find(node => node.props?.['aria-label'] === label);
const content = node => typeof node === 'object' ? React.Children.toArray(node?.props?.children).map(content).join('') : String(node ?? '');
const calendar = (value) => {
  hooks.reset(); const chosen = [], closed = [];
  const props = { value, onChange: date => chosen.push(date), close: () => closed.push(true), anchorOffset: 44 };
  const render = () => { hooks.begin(); return module.BookingCalendar(props); };
  return { render, chosen, closed };
};
test('calendar uses a portalled floating panel, selected date focus and a 42-cell accessible grid', () => {
  const f = calendar(new Date(2026, 9, 31)); const tree = f.render();
  assert.equal(tree.props.portal, true); assert.equal(tree.props.focus, false);
  assert.deepEqual(tree.props.anchor, { to: 'bottom end', gap: 8, offset: 44, padding: 8 });
  assert.equal(elements(tree).filter(node => node.props?.role === 'gridcell').length, 42);
  const selected = elements(tree).find(node => node.type === 'button' && node.props['data-selected']);
  assert.equal(selected.props.tabIndex, 0); assert.equal(content(selected), '31');
  let focused = false; selected.props.ref({ focus: () => { focused = true; } });
  hooks.effects[0](); assert.equal(focused, true);
});
test('month arrows cross year boundaries without selecting; Cancel changes no date', () => {
  const f = calendar(new Date(2026, 11, 31)); let tree = f.render();
  labeled(tree, 'Next month').props.onClick(); tree = f.render();
  assert.equal(content(elements(tree).find(node => node.type === 'h2')), 'January 2027');
  labeled(tree, 'Previous month').props.onClick(); tree = f.render();
  assert.equal(content(elements(tree).find(node => node.type === 'h2')), 'December 2026');
  elements(tree).find(node => node.type === 'button' && content(node) === 'Cancel').props.onClick();
  assert.equal(f.chosen.length, 0); assert.equal(f.closed.length, 1);
});
test('leap day and outside-month day select the actual local calendar day and close once', () => {
  for (const label of ['Tuesday, February 29, 2028', 'Sunday, January 30, 2028']) {
    const f = calendar(new Date(2028, 1, 1)); const tree = f.render();
    const day = labeled(tree, label); assert.ok(day, label); day.props.onClick();
    assert.equal(format(f.chosen[0], 'EEEE, MMMM d, yyyy'), label);
    assert.equal(f.chosen[0].getHours(), 0); assert.equal(f.closed.length, 1);
  }
});
test('keyboard navigation handles week/year boundaries without booking selection', () => {
  const f = calendar(new Date(2026, 11, 31));
  for (const [key, shiftKey, expected] of [['ArrowRight', false, '2027-01-01'], ['Home', false, '2026-12-27'], ['End', false, '2027-01-02'], ['PageDown', false, '2027-02-02'], ['PageUp', true, '2026-02-02'], ['ArrowDown', false, '2026-02-09'], ['ArrowUp', false, '2026-02-02'], ['ArrowLeft', false, '2026-02-01']]) {
    const tree = f.render(); const current = elements(tree).find(node => node.type === 'button' && node.props.tabIndex === 0);
    let prevented = false; current.props.onKeyDown({ key, shiftKey, preventDefault: () => { prevented = true; } });
    assert.equal(prevented, true);
    const next = elements(f.render()).find(node => node.type === 'button' && node.props.tabIndex === 0);
    assert.equal(format(new Date(next.props['aria-label']), 'yyyy-MM-dd'), expected);
    assert.equal(f.chosen.length, 0);
  }
});
test('Today selects the current application-local day, independent of the displayed month', t => {
  const today = new Date(2026, 9, 31, 23, 59);
  t.mock.timers.enable({ apis: ['Date'], now: today.getTime() });
  const f = calendar(new Date(2028, 1, 1)); const tree = f.render();
  elements(tree).find(node => node.type === 'button' && content(node) === 'Today').props.onClick();
  assert.equal(format(f.chosen[0], 'yyyy-MM-dd'), '2026-10-31'); assert.equal(f.closed.length, 1);
});
test('reopening initializes the calendar at the selected booking month', () => {
  const f = calendar(new Date(2028, 1, 29));
  const tree = f.render(); assert.equal(content(elements(tree).find(node => node.type === 'h2')), 'February 2028');
});


test('trigger uses one Popover toggle and panel does not dismiss on focus returning to the trigger', () => {
  hooks.reset(); const changes = [], closes = [];
  const picker = module.default({ value: new Date(2026, 9, 31), onChange: date => changes.push(date) });
  for (const open of [false, true]) {
    const boundary = picker.props.children({ open, close: () => closes.push(true) });
    const trigger = labeled(boundary, 'Choose booking date');
    assert.ok(trigger);
    trigger.props.onClick({ currentTarget: {
      closest: () => ({ getBoundingClientRect: () => ({ right: 300 }) }),
      getBoundingClientRect: () => ({ right: 256 }),
    } });
    assert.equal(changes.length, 0);
    assert.equal(closes.length, 0, 'measurement must not add a second close/toggle');
    const panel = elements(boundary).find(node => node.type === module.BookingCalendar);
    assert.equal(Boolean(panel), open);
  }
  const panel = calendar(new Date(2026, 9, 31)).render();
  assert.equal(panel.props.focus, false, 'disable panel-only onBlur dismissal; Popover owns boundary');
  assert.equal(panel.props.onBlur, undefined);
  assert.equal(panel.props.onPointerDown, undefined);
});
