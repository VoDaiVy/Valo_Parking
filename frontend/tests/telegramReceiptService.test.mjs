import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/services/telegramReceiptService.js', import.meta.url), 'utf8');
const instrumented = source.replace("import { apiFetch } from './api';", "const apiFetch = (...args) => globalThis.__receiptApiFetch(...args);");
const service = await import(`data:text/javascript;base64,${Buffer.from(instrumented).toString('base64')}`);

test('booking linking uses account authorization and the exact booking ID', async () => {
  const calls = [];
  globalThis.localStorage = { getItem: () => 'account-token' };
  globalThis.__receiptApiFetch = async (...args) => { calls.push(args); return { ok: true, data: { data: { deepLink: 'https://t.me/valo_bot?start=claim', expiresAt: '2030-01-01' } } }; };
  try {
    await service.bookingReceipt('booking/123');
    const linked = await service.linkBookingReceipt('booking/123');
    assert.equal(calls[0][0], '/telegram/bookings/booking%2F123/receipt');
    assert.equal(calls[1][0], '/telegram/link-token');
    assert.deepEqual(JSON.parse(calls[1][1].body), { bookingId: 'booking/123' });
    assert.equal(calls[1][1].headers.Authorization, 'Bearer account-token');
    assert.equal(linked.claimLink, 'https://t.me/valo_bot?start=claim');
    assert.equal(linked.state, 'needs_link');
  } finally { delete globalThis.localStorage; delete globalThis.__receiptApiFetch; }
});

test('booking receipt and linking reject API errors without reporting delivery success', async () => {
  globalThis.localStorage = { getItem: () => 'account-token' };
  globalThis.__receiptApiFetch = async () => ({ ok: false, data: { success: false } });
  try {
    await assert.rejects(service.bookingReceipt('other-user-booking'), /request_failed/);
    await assert.rejects(service.linkBookingReceipt('other-user-booking'), /request_failed/);
  } finally { delete globalThis.localStorage; delete globalThis.__receiptApiFetch; }
});
