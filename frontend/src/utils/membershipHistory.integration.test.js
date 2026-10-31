import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

test('actual membership API client preserves three failed attempts and the details renewal denial', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false, ws: false }, optimizeDeps: { noDiscovery: true } });
  const previousFetch = globalThis.fetch;
  const previousStorage = globalThis.localStorage;
  const id = '507f1f77bcf86cd7950fc99d';
  const items = ['ba7d0299', 'ba7cff5b', 'ba7cff4f'].map((suffix) => ({
    _id: `507f1f77bcf86cd7${suffix}`, scope: 'entitlement', status: 'failed', amount: 50000,
    paymentMethod: 'payos', createdAt: '2026-10-22T10:16:16.616Z',
    oldExpireAt: '2026-10-22T13:42:46.553Z', newExpireAt: '2026-11-22T13:42:46.553Z',
  }));
  const renewal = { canRenew: false, reasonCode: 'MEMBERSHIP_FLOOR_NOT_FOUND', message: 'Renewal is unavailable: the referenced parking floor no longer exists. Please contact parking support.' };
  const requests = [];
  globalThis.localStorage = { getItem: () => 'fixture-token' };
  globalThis.fetch = async (url, options) => {
    requests.push({ url: String(url), options });
    const history = String(url).includes('/renewals?');
    const secondPage = String(url).includes('page=2');
    return { ok: true, status: 200, json: async () => ({ success: true, data: history
      ? { items: secondPage ? [] : items, pagination: { page: secondPage ? 2 : 1, limit: 10, total: 3, totalPages: 1 } }
      : { entitlementId: id, renewal } }) };
  };
  try {
    const api = await server.ssrLoadModule('/src/services/subscriptionService.js');
    const first = await api.getMembershipRenewalHistory('entitlement', id);
    assert.equal(first.ok, true);
    assert.deepEqual(first.data.data.items, items); // Same envelope consumed by the modal.
    assert.equal(first.data.data.pagination.total, 3);
    assert.ok(requests.at(-1).url.endsWith(`/subscriptions/entitlements/${id}/renewals?page=1&limit=10`));
    const second = await api.getMembershipRenewalHistory('entitlement', id, 2);
    assert.deepEqual(second.data.data.items, []);
    const detail = await api.getMembershipDetail('entitlement', id);
    assert.deepEqual(detail.data.data.renewal, renewal);
    assert.ok(requests.at(-1).url.endsWith(`/subscriptions/entitlements/${id}/details`));
    assert.equal(requests.at(-1).options.headers.Authorization, 'Bearer fixture-token');
    assert.ok(requests.every(({ options }) => options.method === undefined || options.method === 'GET'));
  } finally {
    if (previousFetch === undefined) delete globalThis.fetch; else globalThis.fetch = previousFetch;
    if (previousStorage === undefined) delete globalThis.localStorage; else globalThis.localStorage = previousStorage;
    await server.close();
  }
});
