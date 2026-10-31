import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

test('history client sends authenticated read request with server filter and page; preserves failures', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false, ws: false }, optimizeDeps: { noDiscovery: true } });
  const originalFetch = globalThis.fetch;
  const originalStorage = globalThis.localStorage;
  const requests = [];
  globalThis.localStorage = { getItem: () => 'test-token' };
  globalThis.fetch = async (url, options) => {
    requests.push({ url: String(url), options });
    return { ok: false, status: 503, json: async () => ({ success: false, message: 'Unavailable' }) };
  };
  try {
    const api = await server.ssrLoadModule('/src/services/subscriptionService.js');
    const response = await api.getMembershipActivity({ page: 2, filter: 'payments' });
    const request = requests[0];
    const url = new URL(request.url);
    assert.equal(url.pathname, '/api/subscriptions/membership/history');
    assert.equal(url.searchParams.get('page'), '2');
    assert.equal(url.searchParams.get('filter'), 'payments');
    assert.equal(url.searchParams.has('userId'), false);
    assert.equal(request.options.headers.Authorization, 'Bearer test-token');
    assert.ok(!request.options.method || request.options.method === 'GET');
    assert.equal(response.ok, false);
    assert.equal(response.status, 503);
  } finally {
    if (originalFetch === undefined) delete globalThis.fetch; else globalThis.fetch = originalFetch;
    if (originalStorage === undefined) delete globalThis.localStorage; else globalThis.localStorage = originalStorage;
    await server.close();
  }
});
