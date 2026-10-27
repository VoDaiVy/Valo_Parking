import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setImmediate } from 'node:timers';
import { parse } from '@babel/parser';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import postcss from 'postcss';
import selectorParser from 'postcss-selector-parser';

// Execute the real UI callbacks with inert hooks and fully mocked fetch/toasts.
// Effects never run: no camera permission, socket, payment or hardware is contacted.
let server; let hooks; let fixture; let Gate;
const previousStorage = globalThis.localStorage;
before(async () => {
  globalThis.localStorage = {getItem: () => 'fixture-token'};
  server = await createServer({
    optimizeDeps: {noDiscovery: true, include: []}, server: {middlewareMode: true, hmr: false}, appType: 'custom',
    plugins: [{
      name: 'isolated-gate-ui', enforce: 'pre',
      resolveId(id) { if (id.startsWith('virtual:gate-')) return `\0${id}`; },
      load(id) {
        if (id === '\0virtual:gate-hooks') return `
          let state = [], cursor = 0;
          export const seed = (values) => { state = [...values]; cursor = 0; };
          export const begin = () => { cursor = 0; };
          export const values = () => state;
          export const useState = (initial) => { const key = cursor++; if (!(key in state)) state[key] = typeof initial === 'function' ? initial() : initial; return [state[key], next => { state[key] = typeof next === 'function' ? next(state[key]) : next; }]; };
          export const useEffect = () => {};
          export const useRef = () => ({current: null});
          export const useCallback = (fn) => fn;
        `;
        if (id === '\0virtual:gate-fixture') return `
          export const messages = [];
          const toast = (value) => messages.push(['notice', value]);
          toast.error = (value) => messages.push(['error', value]);
          toast.success = (value) => messages.push(['success', value]);
          export default toast;
          export const Toaster = () => null;
          export const API_BASE = 'https://mock.invalid/api';
          export const useSocket = () => null;
          export const getAllFloors = async () => ({ok:true, data:{data:[]}});
        `;
      },
      transform(source, id) {
        if (!id.replaceAll('\\', '/').endsWith('/pages/Staff/GateControl.jsx')) return;
        return source.replace("from 'react'", "from 'virtual:gate-hooks'")
          .replace(/from '(react-hot-toast|\.\.\/\.\.\/services\/api|\.\.\/\.\.\/hooks\/useSocket|\.\.\/\.\.\/services\/parkingFloorService)'/g, "from 'virtual:gate-fixture'");
      },
    }],
  });
  hooks = await server.ssrLoadModule('virtual:gate-hooks'); fixture = await server.ssrLoadModule('virtual:gate-fixture');
  Gate = (await server.ssrLoadModule('/src/pages/Staff/GateControl.jsx')).default;
});
after(async () => { await server?.close(); globalThis.localStorage = previousStorage; });
const seed = (overrides = {}) => {
  fixture.messages.length = 0;
  hooks.seed(Object.assign([
    {ENTRY_1: {open: false, holdOpen: false}, EXIT_1: {open: false, holdOpen: false}}, true, false,
    [{_id:'floor-1', floorNumber:1, name:'Original Floor Name'}], [], '', '', 'car', 'floor-1', 'A-01', null, null, false, false, true,
    '', null, null, false, false, true, false, false, 'entry', '', null, [], '', '',
  ], overrides));
};
const tree = () => { hooks.begin(); return Gate(); };
const htmlOf = (node) => renderToStaticMarkup(node);
const nodes = (node) => !node || typeof node !== 'object' ? [] : [node, ...React.Children.toArray(node.props?.children).flatMap(nodes)];
const textOf = (node) => node == null || typeof node === 'boolean' ? '' : typeof node !== 'object' ? String(node) : React.Children.toArray(node.props?.children).map(textOf).join('');
const button = (page, label) => nodes(page).find((node) => node.type === 'button' && textOf(node) === label);
const tick = () => new Promise((resolve) => setImmediate(resolve));
const mockFetch = (t, responseFor = () => ({success:true, gates:{}, data:[]})) => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => { calls.push({url, options}); return {json: async () => responseFor(url, options)}; });
  return calls;
};

test('header, stations and operational buttons render professional English in original order', () => {
  seed(); const page = tree(); const html = htmlOf(page);
  assert.ok(!html.includes('VALO / STAFF OPERATIONS'));
  for (const label of ['Gate Control &amp; Camera Stations', 'Monitor entry and exit lanes, verify license plates', 'LIVE TELEMETRY', 'ESP32 GATE BRIDGE', 'Entry Lane', 'ENTRY_1', 'Exit Lane', 'EXIT_1', 'Entry Plate Detection Area', 'Exit Plate Detection Area', 'Detected License Plate', 'Phone Number', 'Parking Floor', 'Parking Slot', 'Parked Vehicles', 'Upload Vehicle Image', 'Barrier: Closed']) assert.ok(html.includes(label), label);
  const labels = nodes(page).filter((node) => node.type === 'button').map(textOf);
  assert.deepEqual(labels, ['Auto-Pilot OFF','Emergency Open','Capture & Scan','AI Plate Assistant','Check In & Open Gate','Open Entry Barrier','Pause','Lock Barrier','Capture & Scan','AI Plate Assistant','Check Out & Open Gate','Open Exit Barrier','Pause','Lock Barrier']);
  assert.equal(button(page, 'Check In & Open Gate').props.disabled, true);
  assert.equal(button(page, 'Check Out & Open Gate').props.disabled, true);
});
test('verification branches, slot descriptions and open/offline/busy states retain conditions', () => {
  for (const [verify, expected] of [[{isActive:true}, 'Warning: Vehicle already parked.'], [{isMonthly:true}, 'VIP customer: Monthly Pass'], [{hasPreBooking:true, bookingId:'booking-1'}, 'Reserved customer (Booking booking-1)'], [{}, 'Valid walk-in vehicle']]) {
    seed({11:verify}); assert.ok(htmlOf(tree()).includes(expected));
  }
  seed({0:{ENTRY_1:{open:true}, EXIT_1:{open:false}}, 1:false, 12:true, 13:true});
  const page = tree(); assert.ok(htmlOf(page).includes('Barrier: Open')); assert.ok(htmlOf(page).includes('DISCONNECTED'));
  assert.equal(button(page, 'Capture & Scan').props.disabled, true); assert.equal(button(page, 'Check In & Open Gate').props.disabled, true);
});
test('invoice localization keeps financial data, security images and cash confirmation', () => {
  seed({17:{session:{_id:'session-1', licensePlate:'51A-12345', type:'STANDARD', checkInTime:'2026-10-25T01:00:00Z'}, totalAmount:25000, parkingFee:25000}});
  const page = tree(); const html = htmlOf(page);
  for (const label of ['Security Double-Check','Entry Image (Check-in)','Exit Image (Check-out)','No entry image','Parking Duration:','2 hours','Session Type:','STANDARD','Parking Fee:','Total Due:','25.000','Cash payment received from the customer']) assert.ok(html.includes(label), label);
  const cash = nodes(page).find((node) => node.type === 'input' && node.props.type === 'checkbox');
  cash.props.onChange({target:{checked:true}}); assert.equal(hooks.values()[21], true);
  assert.equal(button(page, 'Check Out & Open Gate').props.disabled, false);
});
test('device and plate data remain unchanged; snapshot geometry and AI open/close callback stay intact', () => {
  seed({5:'51A-12345', 10:'/fixture/entry.jpg', 26:[{deviceId:'device-1', label:'Original Device Label'}]});
  const page = tree(); const html = htmlOf(page);
  assert.ok(html.includes('Original Device Label')); assert.ok(html.includes('Original Floor Name'));
  const videos = nodes(page).filter((node) => node.type === 'video'); assert.equal(videos.length, 2);
  for (const video of videos) { assert.ok(video.props.className.includes('h-full w-full object-cover')); assert.equal(video.props.autoPlay, true); assert.equal(video.props.muted, true); }
  assert.equal(nodes(page).filter((node) => node.props?.className?.includes('relative aspect-video w-full')).length, 2);
  button(page, 'AI Plate Assistant').props.onClick(); assert.equal(hooks.values()[22], true); assert.equal(hooks.values()[23], 'entry'); assert.equal(hooks.values()[24], '51A-12345');
  const modal = nodes(tree()).find((node) => node.props?.initialPlate !== undefined);
  modal.props.onClose(); assert.equal(hooks.values()[22], false);
});
test('camera-unavailable scan, entry validation and server errors use localized UI messages', async (t) => {
  seed(); await button(tree(), 'Capture & Scan').props.onClick();
  assert.deepEqual(fixture.messages.at(-1), ['error','Allow camera access or upload an image to scan.']);
  await button(tree(), 'Check In & Open Gate').props.onClick(); assert.deepEqual(fixture.messages.at(-1), ['error','Enter or scan the entry license plate.']);
  mockFetch(t, () => ({success:false, message:'Original backend message'})); seed({5:'51A-12345'});
  await button(tree(), 'Check In & Open Gate').props.onClick(); assert.deepEqual(fixture.messages.at(-1), ['error','Original backend message']);
});
test('manual barrier controls preserve exact endpoints and protocol payloads with mocked fetch', async (t) => {
  const calls = mockFetch(t); seed({5:'51A-12345'}); let page = tree();
  await button(page, 'Open Entry Barrier').props.onClick();
  await button(page, 'Pause').props.onClick();
  await button(page, 'Lock Barrier').props.onClick();
  await button(page, 'Open Exit Barrier').props.onClick();
  assert.deepEqual(calls.filter((call) => call.options?.method === 'POST').map((call) => [call.url.split('/api')[1], JSON.parse(call.options.body)]), [
    ['/iot/open-barrier',{gate:'ENTRY_1',licensePlate:'51A-12345',slotCode:''}], ['/iot/hold-barrier',{gate:'ENTRY_1',hold:true}], ['/iot/close-barrier',{gate:'ENTRY_1'}], ['/iot/open-barrier',{gate:'EXIT_1',licensePlate:'MANUAL_EXIT',slotCode:''}],
  ]);
  page = tree(); button(page, 'Auto-Pilot OFF').props.onClick(); assert.equal(hooks.values()[2], true);
  assert.ok(fixture.messages.at(-1)[1].startsWith('Auto-Pilot enabled'));
});
test('emergency action retains both gate commands and identifiers, without contacting hardware', async (t) => {
  const calls = mockFetch(t); seed(); button(tree(), 'Emergency Open').props.onClick(); await tick();
  const posts = calls.filter((call) => call.options?.method === 'POST');
  assert.deepEqual(posts.map((call) => JSON.parse(call.options.body)), [{gate:'ENTRY_1',licensePlate:'EMERGENCY_OPEN',slotCode:''},{gate:'EXIT_1',licensePlate:'EMERGENCY_OPEN',slotCode:''}]);
});
test('check-in and check-out keep camera IDs, gate IDs, session fields and payment enum values', async (t) => {
  const calls = mockFetch(t); seed({5:'51A-12345', 6:'0912345678', 10:'/entry.jpg'});
  await button(tree(), 'Check In & Open Gate').props.onClick();
  assert.deepEqual(JSON.parse(calls.find((call) => call.url.endsWith('/sessions/kiosk-entry')).options.body), {licensePlate:'51A12345',phone:'0912345678',vehicleType:'car',parkingSlot:'A-01',floorId:'floor-1',durationHours:2,entryImageBase64:'/entry.jpg',entryCamera:'CAM_GATE_ENTRY_01',entryGate:'ENTRY_1'});
  seed({16:'/exit.jpg',17:{session:{_id:'session-1',licensePlate:'51A-12345'},totalAmount:25000},21:true});
  await button(tree(), 'Check Out & Open Gate').props.onClick();
  assert.deepEqual(JSON.parse(calls.find((call) => call.url.endsWith('/sessions/kiosk-checkout')).options.body), {sessionId:'session-1',exitImageBase64:'/exit.jpg',paymentMethod:'CASH',exitCamera:'CAM_GATE_EXIT_01',exitGate:'EXIT_1'});
});
test('static UI text contains no Vietnamese literals; protocol identifiers and format locales remain', () => {
  const source = readFileSync(new URL('../GateControl.jsx', import.meta.url), 'utf8');
  const ast = parse(source, {sourceType:'module',plugins:['jsx']});
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (['StringLiteral','JSXText','TemplateElement'].includes(node.type)) {
      const value = node.type === 'TemplateElement' ? node.value.cooked : node.value;
      assert.ok(!/[\u00c0-\u024f\u1e00-\u1eff]/.test(value), value);
    }
    for (const [key,value] of Object.entries(node)) if (!['comments','leadingComments','trailingComments','innerComments'].includes(key)) {
      if (Array.isArray(value)) value.forEach(walk); else if (value && typeof value === 'object') walk(value);
    }
  };
  walk(ast);
  for (const value of ['ENTRY_1','EXIT_1','EMERGENCY_OPEN','CAM_GATE_ENTRY_01','CAM_GATE_EXIT_01',"'CASH' : 'PAYOS'","'vi-VN'",'gate:barrier_control']) assert.ok(source.includes(value));
});
test('CSS is scoped to Gate Control and does not alter video, canvas or detection geometry', () => {
  const source = readFileSync(new URL('staffGateControl.css', import.meta.url), 'utf8');
  postcss.parse(source).walkRules((rule) => selectorParser((root) => root.each((selector) => {
    assert.ok(selector.toString().trim().startsWith('body[data-valo-typography="staff"] .staff-gate-control'));
    assert.ok(!/\b(video|canvas|img)\b|aspect-video|h-28|w-64/.test(selector.toString()));
  })).processSync(rule.selector));
  assert.ok(source.includes('prefers-reduced-motion: reduce')); assert.ok(!source.includes('!important'));
});
