import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

test('real history rows expose native disclosure and only available safe details', async () => {
  const server = await createServer({ configFile: false, plugins: [
    { name: 'history-test-export', enforce: 'pre', transform(source, id) {
      if (id.endsWith('/MembershipHistoryDrawer.jsx')) return source + '\nexport { Activity };';
    } }, react(),
  ], server: { middlewareMode: true, hmr: false, ws: false }, optimizeDeps: { noDiscovery: true } });
  try {
    const { Activity } = await server.ssrLoadModule('/src/components/membership/MembershipHistoryDrawer.jsx');
    const render = (item) => renderToStaticMarkup(createElement(Activity, { item }));
    const failed = render({ kind: 'renewal', status: 'failed', title: 'Payment failed', summary: 'No extension was applied.', newExpireAt: '2030-02-01T00:00:00Z', rawProviderError: 'sensitive-fixture' });
    assert.match(failed, /<details/); assert.match(failed, /<summary>Activity details<\/summary>/);
    assert.ok(failed.includes('No extension was applied.'));
    assert.ok(!failed.includes('New expiry')); assert.ok(!failed.includes('sensitive-fixture'));
    assert.ok(!failed.includes('PayOS')); assert.ok(!failed.includes('VND'));
    const paid = render({ kind: 'renewal', status: 'paid', title: 'Renewed', amount: 0, paymentMethod: 'wallet', oldExpireAt: '2030-01-01T00:00:00Z', newExpireAt: '2030-02-01T00:00:00Z' });
    assert.ok(paid.includes('New expiry')); assert.ok(paid.includes('VALO Wallet')); assert.ok(paid.includes('0 VND'));
    assert.ok(!render({ kind: 'purchase', status: 'pending', title: 'Purchase' }).includes('<details'));
  } finally { await server.close(); }
});
