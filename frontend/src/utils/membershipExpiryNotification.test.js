import test from 'node:test';
import assert from 'node:assert/strict';
import { membershipExpiryNotification } from './membershipExpiryNotification.js';
import { getSafeCustomerNotificationLink } from './notificationLinks.js';
const notice = {
  title: 'Old long title', content: 'Old raw date: 2026-11-05T14:41:59.000Z (Vietnam time)',
  metadata: { eventType: 'MEMBERSHIP_ENTITLEMENT_EXPIRING_SOON', packageName: 'Premium Monthly', slotCode: 'E8', floorName: 'Floor 2', expireAt: '2026-11-05T14:41:59.000Z', entitlementId: '507f1f77bcf86cd799439011', subscriptionId: '507f1f77bcf86cd799439012', ownerId: 'fixture-owner' },
};

test('expiry dropdown/detail use Vietnam date and minute precision without mutating records or redirects', () => {
  const before = JSON.stringify(notice);
  const result = membershipExpiryNotification(notice);
  assert.equal(result.title, 'Membership expiring soon');
  assert.equal(result.summary, 'Premium Monthly \u00b7 E8, Floor 2\nExpires 5 Nov 2026 \u00b7 Renew now to keep your space.');
  assert.ok(result.content.includes('5 Nov 2026, 21:41.'));
  assert.ok(result.content.includes('Review renewal eligibility'));
  assert.ok(!/GMT|Vietnam time|T14:|:59/.test(result.content + result.summary));
  assert.equal(JSON.stringify(notice), before);
  assert.equal(getSafeCustomerNotificationLink(notice), `/customer/membership-transfers?entitlementId=${notice.metadata.entitlementId}`);
});

test('timezone rollover, legacy event/cycle and offset timestamps remain accurate', () => {
  for (const eventType of ['VIP_EXPIRING_SOON', 'SUBSCRIPTION_EXPIRING_SOON']) {
    const result = membershipExpiryNotification({ metadata: { ...notice.metadata, eventType, expireAt: undefined, expiryCycle: '2026-11-04T18:41:05Z' } });
    assert.ok(result.content.includes('5 Nov 2026, 01:41'));
  }
  const result = membershipExpiryNotification({ metadata: { ...notice.metadata, expireAt: '2026-11-05T21:41:00+07:00' } });
  assert.ok(result.content.includes('5 Nov 2026, 21:41'));
});

test('missing/invalid historic metadata does not invent dates or echo raw messages', () => {
  for (const expireAt of [undefined, null, 'bad', '2026-11-05T21:41:00']) {
    const result = membershipExpiryNotification({ ...notice, metadata: { eventType: 'VIP_EXPIRING_SOON', expireAt } });
    assert.ok(result.content.includes('Expiry date unavailable'));
    assert.ok(!result.content.includes('2026-11-05'));
    assert.ok(!result.content.includes('undefined'));
  }
});

test('other notification categories and expired events retain their original presentation', () => {
  for (const eventType of ['MEMBERSHIP_ENTITLEMENT_EXPIRED', 'BOOKING_SUCCESS', undefined]) assert.equal(membershipExpiryNotification({ ...notice, metadata: { ...notice.metadata, eventType } }), null);
});

test('historical renewal success messages render compactly without raw time text or record changes', () => {
  for (const eventType of ['MEMBERSHIP_ENTITLEMENT_RENEWAL_SUCCESS', 'SUBSCRIPTION_RENEWAL_SUCCESS']) {
    const renewed = { ...notice, title: 'Membership renewal successful', content: 'Premium Monthly - space E8, Floor 2 was renewed. The new expiration is 5 Dec 2026, 21:41:31 GMT+7 (Vietnam time).', metadata: { ...notice.metadata, eventType, expireAt: '2026-12-05T14:41:31.000Z' } };
    const original = JSON.stringify(renewed);
    const result = membershipExpiryNotification(renewed);
    assert.equal(result.title, 'Membership renewed successfully');
    assert.equal(result.summary, 'Premium Monthly \u00b7 E8, Floor 2\nValid until 5 Dec 2026.');
    assert.ok(result.content.includes('5 Dec 2026, 21:41.'));
    assert.ok(!/GMT|Vietnam time|:31|Renew now/.test(result.summary + result.content));
    assert.equal(JSON.stringify(renewed), original);
    assert.equal(getSafeCustomerNotificationLink(renewed), `/customer/membership-transfers?entitlementId=${renewed.metadata.entitlementId}`);
  }
});
