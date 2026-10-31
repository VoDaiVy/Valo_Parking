import { Buffer } from 'node:buffer';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';

// Execute the actual Navbar and detail hook handlers without browser/production APIs.
test('MainLayout Navbar More selects the shared modal after closing the dropdown; read remains independent', async () => {
  const previous = globalThis.sessionStorage;
  globalThis.sessionStorage = { getItem: () => JSON.stringify({ role: 'customer', name: 'Fixture' }) };
  const server = await createServer({ configFile: false, optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true, hmr: false, ws: false }, plugins: [{
    name: 'notification-wiring-fixtures', enforce: 'pre',
    resolveId(id) { if (id.startsWith('virtual:notification-wiring')) return '\0' + id; },
    load(id) {
      if (id === '\0virtual:notification-wiring-hooks') return `
        let states = [], cursor = 0;
        export const begin = () => { cursor = 0; };
        export const useState = (initial) => { const i = cursor++; if (!(i in states)) states[i] = typeof initial === 'function' ? initial() : initial; return [states[i], (next) => { states[i] = typeof next === 'function' ? next(states[i]) : next; }]; };
        export const useEffect = () => {};
        export const useRef = () => ({current: null});
        export const useId = () => 'fixture-id';
        export const portalTargets = [];
        export const createPortal = (node, target) => { portalTargets.push(target); return node; };
        export const useCallback = (fn) => fn;
        export const navigations = [];
        export const useNavigate = () => (path) => navigations.push(path);
        export const useLocation = () => ({pathname: '/'});
      `;
      if (id === '\0virtual:notification-wiring-api') return `
        export const notice = {_id:'507f1f77bcf86cd799439011',title:'Warning fixture',content:'Fixture content',priority:'WARNING',isRead:false};
        export const reads = [];
        export const useNotifications = () => ({notifications:[notice],unreadCount:1,loading:false,hasMore:false,markAsRead:async (id)=>{reads.push(id);},markAllAsRead(){},fetchMore(){},refresh(){}});
      `;
    },
    transform(source, id) {
      if (id.endsWith('/components/Navbar.jsx')) return source
        .replace('import { useState, useEffect, useRef, useCallback } from "react";', 'import { useState, useEffect, useRef, useCallback, useNavigate, useLocation } from "virtual:notification-wiring-hooks";')
        .replace('Link, NavLink, useNavigate, useLocation', 'Link, NavLink')
        .replace('"../hooks/useNotifications"', '"virtual:notification-wiring-api"');
      if (id.endsWith('/notifications/NotificationDetailModal.jsx')) return source
        .replace("from 'react'", "from 'virtual:notification-wiring-hooks'")
        .replace("from 'react-dom'", "from 'virtual:notification-wiring-hooks'")
        .replace("from 'react-router-dom'", "from 'virtual:notification-wiring-hooks'");
      if (id.endsWith('/hooks/useNotificationDetails.js')) return source.replace("'react'", "'virtual:notification-wiring-hooks'");
    },
  }, react()] });
  const find = (node, predicate) => {
    if (!node || typeof node !== 'object') return null;
    if (predicate(node)) return node;
    for (const child of [node.props?.children].flat(Infinity)) { const result = find(child, predicate); if (result) return result; }
    return null;
  };
  try {
    const hooks = await server.ssrLoadModule('virtual:notification-wiring-hooks');
    const api = await server.ssrLoadModule('virtual:notification-wiring-api');
    const { default: Navbar } = await server.ssrLoadModule('/src/components/Navbar.jsx');
    const { default: Row } = await server.ssrLoadModule('/src/components/notifications/NotificationDropdownItem.jsx');
    const { default: Modal } = await server.ssrLoadModule('/src/components/notifications/NotificationDetailModal.jsx');
    const render = () => { hooks.begin(); return Navbar(); };
    let tree = render();
    find(tree, (n) => n.props?.id === 'nav-notifications').props.onClick();
    tree = render(); let row = find(tree, (n) => n.type === Row);
    assert.ok(row, 'public Customer header must render recovered PNG row');
    await row.props.onRead(api.notice._id);
    tree = render(); assert.equal(find(tree, (n) => n.type === Modal).props.notification, null);
    assert.ok(find(tree, (n) => n.type === Row), 'read does not close or open anything');
    row = find(tree, (n) => n.type === Row); row.props.onOpen();
    tree = render();
    assert.equal(find(tree, (n) => n.type === Row), null, 'dropdown closes');
    const modal = find(tree, (n) => n.type === Modal);
    assert.equal(modal.props.notification, api.notice, 'selected record survives dropdown unmount');
    assert.equal(modal.props.contextRole, 'customer');
    const previousDocument = globalThis.document;
    const body = { fixture: true };
    try {
      globalThis.document = { body };
      const dialogTree = Modal(modal.props);
      assert.equal(hooks.portalTargets.at(-1), body, 'actual modal portals outside navbar/dropdown');
      assert.equal(dialogTree.props.open, true);
      assert.equal(find(dialogTree, (n) => n.type === 'img').props.src, '/assets/notification-mascots/warning.png');
      const panel = find(dialogTree, (n) => n.props?.className === 'notification-detail__panel');
      const mascot = find(dialogTree, (n) => n.type === 'img');
      assert.ok(panel.props.children.includes(mascot), 'floating mascot is outside the scrolling content');
      const main = find(dialogTree, (n) => n.props?.className === 'notification-detail__main');
      assert.equal(find(main, (n) => n.type === 'img'), null, 'scroll viewport cannot clip the mascot');
      assert.ok(main.props.children.some((n) => n?.type === 'header'));
      assert.ok(main.props.children.some((n) => n?.props?.className === 'notification-detail__body'), 'description remains below header at full content width');
      assert.equal(find(dialogTree, (n) => n.type === 'h2').props.children, api.notice.title);
      dialogTree.props.onClose();
    } finally { if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument; }
    tree = render();
    assert.equal(find(tree, (n) => n.type === Modal).props.notification, null);
    assert.ok(api.reads.includes(api.notice._id));
    Object.assign(api.notice, { title: 'Membership renewed successfully', priority: 'SUCCESS', metadata: { eventType: 'MEMBERSHIP_ENTITLEMENT_RENEWAL_SUCCESS', entitlementId: '507f1f77bcf86cd799439012' } });
    find(tree, (n) => n.props?.id === 'nav-notifications').props.onClick();
    tree = render(); find(tree, (n) => n.type === Row).props.onOpen(); tree = render();
    const renewedModal = find(tree, (n) => n.type === Modal);
    const savedDocument = globalThis.document;
    try {
      globalThis.document = { body: { fixture: true } };
      const dialog = Modal(renewedModal.props);
      assert.equal(find(dialog, (n) => n.type === 'img').props.src, '/assets/notification-mascots/success.png');
      const cta = find(dialog, (n) => n.props?.className === 'type-button notification-detail__primary');
      assert.equal(cta.props.children[0], 'View membership');
      cta.props.onClick();
      assert.equal(hooks.navigations.at(-1), '/customer/membership-transfers?entitlementId=507f1f77bcf86cd799439012');
    } finally { if (savedDocument === undefined) delete globalThis.document; else globalThis.document = savedDocument; }

  } finally { await server.close(); if (previous === undefined) delete globalThis.sessionStorage; else globalThis.sessionStorage = previous; }
});

test('all five original mascot URLs are served as PNGs by the actual Vite public-file handler', async () => {
  const server = await createServer({ configFile: false, server: { host: '127.0.0.1', port: 0, hmr: false, ws: false }, optimizeDeps: { noDiscovery: true } });
  try {
    await server.listen(); const port = server.httpServer.address().port;
    for (const state of ['success', 'info', 'warning', 'error', 'system']) {
      const response = await fetch(`http://127.0.0.1:${port}/assets/notification-mascots/${state}.png`);
      assert.equal(response.status, 200); assert.match(response.headers.get('content-type'), /image\/png/);
      const bytes = Buffer.from(await response.arrayBuffer());
      assert.deepEqual(bytes, await readFile(`public/assets/notification-mascots/${state}.png`));
      assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    }
  } finally { await server.close(); }
});
