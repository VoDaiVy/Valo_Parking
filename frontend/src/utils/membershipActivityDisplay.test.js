import test from 'node:test';
import assert from 'node:assert/strict';
import { activityStatus, activityPayment, activityExpiries } from './membershipActivityDisplay.js';

test('renewal/payment statuses use persisted status, never HTTP or checkout presence', () => {
  for (const [status, label, tone] of [['paid', 'Paid', 'success'], ['failed', 'Failed', 'failed'], ['pending', 'Pending', 'warning'], ['success', 'Success', 'success']]) {
    assert.deepEqual(activityStatus({ kind: 'renewal', status, httpStatus: 200, checkoutUrl: 'fixture' }), { label, tone });
  }
  assert.equal(activityStatus({ kind: 'renewal', httpStatus: 200 }).label, 'Recorded');
});

test('delivered reminders are Sent; Read requires explicit evidence', () => {
  assert.equal(activityStatus({ kind: 'notification', status: 'warning' }).label, 'Sent');
  assert.equal(activityStatus({ kind: 'notification', status: 'warning', isRead: true }).label, 'Read');
});

test('payment row handles wallet, PayOS, missing fields, zero and non-payment activities', () => {
  assert.deepEqual(activityPayment({ kind: 'renewal', paymentMethod: 'wallet', amount: 50000 }), { method: 'VALO Wallet', amount: '50,000 VND' });
  assert.equal(activityPayment({ kind: 'renewal', paymentMethod: 'payos' }).method, 'PayOS');
  assert.equal(activityPayment({ kind: 'renewal' }).amount, undefined);
  assert.equal(activityPayment({ kind: 'purchase', amount: 0 }).amount, '0 VND');
  assert.deepEqual(activityPayment({ kind: 'notification', amount: 50000, paymentMethod: 'wallet' }), {});
});

test('expiry display uses only recorded paid-renewal dates and hides proposed dates on failed/pending attempts', () => {
  const dates = { oldExpireAt: '2026-10-25T14:41:00Z', newExpireAt: '2026-11-25T14:41:00Z' };
  assert.deepEqual(activityExpiries({ kind: 'renewal', status: 'paid', ...dates }).map((field) => field.label), ['Previous expiry', 'New expiry']);
  for (const status of ['failed', 'pending', 'cancelled']) assert.deepEqual(activityExpiries({ kind: 'renewal', status, ...dates }), []);
  assert.deepEqual(activityExpiries({ kind: 'renewal', status: 'paid' }), []);
  assert.equal(activityExpiries({ kind: 'renewal', status: 'paid', newExpireAt: dates.newExpireAt }).length, 1);
  assert.deepEqual(activityExpiries({ kind: 'renewal', status: 'paid', oldExpireAt: 'invalid' }), []);
  assert.deepEqual(activityExpiries({ kind: 'notification', expireAt: dates.oldExpireAt }), [{ label: 'Expiry', value: dates.oldExpireAt, renewed: false }]);
});
