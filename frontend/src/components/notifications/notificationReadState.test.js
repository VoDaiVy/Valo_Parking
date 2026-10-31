import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';

const hooksSource = `
  let states = [], refs = [], cursor = 0, refCursor = 0;
  export const seed = (values = []) => { states = values; refs = []; };
  export const begin = () => { cursor = 0; refCursor = 0; };
  export const useState = (initial) => { const i = cursor++; if (!(i in states)) states[i] = typeof initial === 'function' ? initial() : initial; return [states[i], (next) => { states[i] = typeof next === 'function' ? next(states[i]) : next; }]; };
  export const useRef = (initial) => { const i = refCursor++; return refs[i] ||= {current:initial}; };
  export const useCallback = (fn) => fn;
  export const useEffect = () => {};
`;
const find = (node, predicate) => {
  if (!node || typeof node !== 'object') return null;
  if (predicate(node)) return node;
  for (const child of [node.props?.children].flat(Infinity)) { const result = find(child, predicate); if (result) return result; }
  return null;
};

test('actual Customer hook and shared row wait for API success; failures retain unread; More is independent', async () => {
  const previousWindow = globalThis.window;
  globalThis.window = { dispatchEvent() {} };
  const server = await createServer({ configFile: false, cacheDir: 'node_modules/.vite-notification-read-state-test', optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true, hmr: false, ws: false }, plugins: [{
    name: 'notification-read-fixture', enforce: 'pre',
    resolveId(id) { if (id.startsWith('virtual:read-')) return '\0' + id; },
    load(id) {
      if (id === '\0virtual:read-hooks' || id === '\0virtual:read-row-hooks') return hooksSource;
      if (id === '\0virtual:read-socket') return 'export const useSocket = () => null;';
      if (id === '\0virtual:read-api') return `
        let complete, reject; export let calls = 0;
        export const markAsRead = () => { calls++; return new Promise((yes,no) => {complete=yes;reject=no;}); };
        export const succeed = () => complete({ok:true,data:{success:true}});
        export const fail = () => complete({ok:false,data:{message:'Fixture failure'}});
        export const networkFail = () => reject(new Error('Fixture network failure'));
      `;
    },
    transform(source, id) {
      if (id.endsWith('/hooks/useNotifications.js')) return source
        .replace("from 'react'", "from 'virtual:read-hooks'")
        .replace("from './useSocket'", "from 'virtual:read-socket'")
        .replace("from '../services/notificationService'", "from 'virtual:read-api'");
      if (id.endsWith('/notifications/NotificationDropdownItem.jsx')) return source.replace("from 'react'", "from 'virtual:read-row-hooks'");
    },
  }, react()] });
  try {
    const hooks = await server.ssrLoadModule('virtual:read-hooks');
    const rowHooks = await server.ssrLoadModule('virtual:read-row-hooks');
    const api = await server.ssrLoadModule('virtual:read-api');
    const { useNotifications: runNotifications } = await server.ssrLoadModule('/src/hooks/useNotifications.js');
    const { default: Row } = await server.ssrLoadModule('/src/components/notifications/NotificationDropdownItem.jsx');
    const notice = {_id:'507f1f77bcf86cd799439011',title:'Fixture',content:'Content',priority:'INFO',isRead:false};
    let opens = 0;
    const state = () => { hooks.begin(); return runNotifications({autoFetch:false,contextRole:'customer'}); };
    const render = () => { const data = state(); rowHooks.begin(); return Row({notification:data.notifications[0],onRead:data.markAsRead,onOpen:()=>{opens++;}}); };
    const reset = (read = false) => { hooks.seed([[{...notice,isRead:read}],read ? 0 : 1,false,null,1,true,{type:null,isRead:null,search:''}]); rowHooks.seed(); };
    const button = (tree, text) => find(tree, (n) => n.type === 'button' && n.props.children === text);
    const clickRead = (tree) => button(tree, 'Mark as read').props.onClick({stopPropagation(){}});
    reset(); let tree = render();
    assert.match(tree.props.className, /is-unread/);
    assert.ok(find(tree, (n) => n.props?.['aria-label'] === 'Unread'));
    let request = clickRead(tree); tree = render();
    assert.match(tree.props.className, /is-unread/); assert.equal(state().unreadCount, 1);
    assert.equal(button(tree, 'Marking...').props.disabled, true); assert.equal(opens, 0);
    api.succeed(); await request; tree = render();
    assert.match(tree.props.className, /is-read/); assert.equal(state().unreadCount, 0);
    assert.equal(find(tree, (n) => n.props?.['aria-label'] === 'Unread'), null);
    assert.equal(button(tree, 'Read').props.disabled, true);
    button(tree, 'More').props.onClick(); assert.equal(opens, 1);
    reset(true); tree = render(); const calls = api.calls;
    await button(tree, 'Read').props.onClick({stopPropagation(){}});
    assert.equal(api.calls, calls); assert.match(tree.props.className, /is-read/);
    for (const fail of [api.fail, api.networkFail]) {
      reset(); tree = render(); request = clickRead(tree); fail(); await request; tree = render();
      assert.match(tree.props.className, /is-unread/); assert.equal(state().unreadCount, 1);
      assert.equal(button(tree, 'Mark as read').props.disabled, false);
      assert.ok(find(tree, (n) => n.props?.role === 'alert'));
      const before = opens; button(tree, 'More').props.onClick(); assert.equal(opens, before + 1);
    }
  } finally { await server.close(); if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow; }
});
