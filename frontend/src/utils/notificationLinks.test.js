import test from 'node:test';
import assert from 'node:assert/strict';
import { getSafeCustomerNotificationLink } from './notificationLinks.js';

test('membership events require an exact object and preserve current-detail routing', () => {
  const id = '507f1f77bcf86cd799439011';
  for (const eventType of ['VIP_EXPIRED', 'VIP_EXPIRING_SOON', 'SUBSCRIPTION_RENEWAL_SUCCESS', 'MEMBERSHIP_ENTITLEMENT_RENEWAL_FAILED']) {
    assert.equal(getSafeCustomerNotificationLink({ metadata: { eventType } }), null);
    assert.equal(getSafeCustomerNotificationLink({ type: 'SYSTEM', metadata: { eventType, entitlementId: id, subscriptionId: '507f1f77bcf86cd799439012' } }), `/customer/membership-transfers?entitlementId=${id}`);
    assert.equal(getSafeCustomerNotificationLink({ metadata: { eventType, subscriptionId: id } }), `/customer/membership-transfers?subscriptionId=${id}`);
  }
  assert.equal(getSafeCustomerNotificationLink({ title: 'Membership renewed!' }), null);
});

test('notification links reject external or unlisted destinations while preserving typed fallback', () => {
  const previousWindow = globalThis.window;
  globalThis.window = { location: { origin: 'https://valo.test' } };
  try {
    for (const deepLink of ['https://example.com', '//example.com/path', '/admin/accounts', '/customer/../../admin/accounts']) {
      assert.equal(getSafeCustomerNotificationLink({ metadata: { deepLink } }), null);
    }
    assert.equal(getSafeCustomerNotificationLink({ metadata: { deepLink: '/customer/wallet?orderCode=123' } }), '/customer/wallet?orderCode=123');
    assert.equal(getSafeCustomerNotificationLink({ type: 'BOOKING', metadata: { deepLink: '//example.com', bookingId: 'a&b' } }), null);
    assert.equal(getSafeCustomerNotificationLink({ type: 'BOOKING', metadata: { bookingId: '507f1f77bcf86cd799439011' } }), '/customer/booking?bookingId=507f1f77bcf86cd799439011');
    assert.equal(getSafeCustomerNotificationLink({ metadata: { deepLink: '/customer/membership-transfers' } }), null);
    assert.equal(getSafeCustomerNotificationLink({ metadata: { deepLink: '/customer/booking' } }), null);
    assert.equal(getSafeCustomerNotificationLink({ metadata: { deepLink: '/customer/membership-transfers?tab=marketplace&entitlementId=507f1f77bcf86cd799439011' } }), '/customer/membership-transfers?entitlementId=507f1f77bcf86cd799439011');
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});
