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

test('booking linking preserves missing profile phone errors for the profile recovery link', async () => {
  globalThis.localStorage = { getItem: () => 'account-token' };
  globalThis.__receiptApiFetch = async () => ({ ok: false, data: { success: false, code: 'PROFILE_PHONE_REQUIRED', message: 'Save a valid profile phone first.' } });
  try {
    await assert.rejects(service.linkBookingReceipt('booking-id'), error => error.code === 'PROFILE_PHONE_REQUIRED' && error.message === 'Save a valid profile phone first.');
  } finally { delete globalThis.localStorage; delete globalThis.__receiptApiFetch; }
});

test('already requested booking stays locked and does not become a new link request', async () => {
  globalThis.localStorage = { getItem: () => 'account-token' };
  try {
    for (const state of ['pending', 'processing', 'sent', 'uncertain']) {
      globalThis.__receiptApiFetch = async () => ({ ok: true, data: { success: true, data: { state } } });
      const result = await service.linkBookingReceipt('booking-id');
      assert.equal(result.state, state);
      assert.equal(result.claimLink, undefined);
      assert.equal(service.receiptRequestLocked(state), true);
    }
    for (const state of ['needs_link', 'needs_phone', 'failed', 'cancelled', undefined]) {
      assert.equal(service.receiptRequestLocked(state), false);
    }
  } finally { delete globalThis.localStorage; delete globalThis.__receiptApiFetch; }
});
