import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

let server; let Controller;
before(async () => {
  server = await createServer({ optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, hmr: false }, appType: 'custom' });
  Controller = (await server.ssrLoadModule('/src/pages/Admin/SubscriptionDeepLink.jsx')).default;
});
after(async () => { await server?.close(); });
const render = (status, loading = false) => renderToStaticMarkup(React.createElement(Controller, { state: { status }, loading, cardRef: { current: null } }));

test('successful link renders no extra section, card or details', () => {
  assert.equal(render('ready'), '');
});

test('pending, missing, error and access fallback are small messages instead of duplicate cards', () => {
  for (const [status, message] of [['loading', 'Locating subscription'], ['missing', 'Subscription not found'], ['error', 'Unable to load the linked subscription'], ['unavailable', 'Subscription unavailable']]) {
    const html = render(status, status === 'loading');
    assert.ok(html.startsWith('<p '));
    assert.ok(html.includes(message));
    assert.ok(!html.includes('<section'));
    assert.ok(!html.includes('<article'));
    assert.ok(!html.includes('Subscription details'));
  }
});
