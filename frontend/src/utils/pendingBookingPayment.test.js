import test from 'node:test';
import assert from 'node:assert/strict';
import { clearPendingBookingPayment, readPendingBookingPayment, writePendingBookingPayment } from './pendingBookingPayment.js';

const memoryStorage = () => {
  const values = new Map([['valo_user', JSON.stringify({ id: 'user-1' })]]);
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
};

test('pending booking payment survives refresh and remains scoped by flow', () => {
  const storage = memoryStorage();
  const payment = { orderCode: 123, qrCode: 'qr', createdAt: '2026-10-08T06:00:00.000Z' };
  assert.equal(writePendingBookingPayment('quick', payment, storage), true);
  assert.equal(readPendingBookingPayment('quick', storage, Date.parse('2026-10-08T06:10:00.000Z')).orderCode, 123);
  assert.equal(readPendingBookingPayment('regular', storage, Date.parse('2026-10-08T06:10:00.000Z')), null);
  clearPendingBookingPayment('quick', storage);
  assert.equal(readPendingBookingPayment('quick', storage, Date.parse('2026-10-08T06:10:00.000Z')), null);
});

test('stale pending payment is discarded', () => {
  const storage = memoryStorage();
  writePendingBookingPayment('regular', {
    orderCode: 456, createdAt: '2026-10-08T06:00:00.000Z',
  }, storage);
  assert.equal(readPendingBookingPayment('regular', storage, Date.parse('2026-10-08T07:00:00.000Z')), null);
});
