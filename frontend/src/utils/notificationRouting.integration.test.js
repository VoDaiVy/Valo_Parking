import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { getSafeCustomerNotificationLink } from './notificationLinks.js';

test('actual dropdown renders five status avatars and independent read / more buttons', async () => {
  const server = await createServer({ configFile: false, plugins: [react()], server: { middlewareMode: true, hmr: false, ws: false }, optimizeDeps: { noDiscovery: true } });
  try {
    const { default: Row } = await server.ssrLoadModule('/src/components/notifications/NotificationDropdownItem.jsx');
    for (const [priority, icon, color, label] of [
      ['INFO', 'info', 'blue', 'Information'], ['SUCCESS', 'success', 'emerald', 'Success'],
      ['WARNING', 'warning', 'amber', 'Warning'], ['ERROR', 'error', 'red', 'Error'], ['SYSTEM', 'system', 'purple', 'System'],
    ]) {
      const notification = { _id: '507f1f77bcf86cd799439011', type: 'SYSTEM', priority, title: 'Sender title', content: 'Sender content', createdAt: '2026-10-21T01:00:00Z', isRead: false };
      const html = renderToStaticMarkup(createElement(Row, { notification, onRead() {}, onOpen() {} }));
      assert.ok(html.includes(`/assets/notification-mascots/${icon}.png`));
      assert.match(html, /width="48" height="48"/);
      assert.match(html, new RegExp(`bg-${color}-100`));
      assert.ok(html.includes(`aria-label="${label}"`));
      assert.match(html, /Mark as read/);
      assert.match(html, />More<\/button>/);
      const readHtml = renderToStaticMarkup(createElement(Row, { notification: { ...notification, isRead: true } }));
      assert.match(readHtml, /disabled=""[^>]*>Read<\/button>/);
      assert.match(readHtml, new RegExp(`bg-${color}-100`), 'read state does not replace status with grey');
    }
  } finally { await server.close(); }
});

test('resolved exact-object URLs survive reload parsing and invoke actual API clients with the same IDs', async () => {
  const server = await createServer({ configFile: false, plugins: [react()], server: { middlewareMode: true, hmr: false, ws: false }, optimizeDeps: { noDiscovery: true } });
  const previousFetch = globalThis.fetch;
  const previousStorage = globalThis.localStorage;
  const requests = [];
  globalThis.localStorage = { getItem: () => 'fixture-token' };
  globalThis.fetch = async (url, options) => {
    requests.push({ url: String(url), options });
    return { ok: true, status: 200, json: async () => ({ success: true, data: {} }) };
  };
  try {
    const membership = await server.ssrLoadModule('/src/services/subscriptionService.js');
    const id = '507f1f77bcf86cd799439011';
    for (const [eventType, field, kind, endpoint] of [
      ['MEMBERSHIP_ENTITLEMENT_EXPIRING_SOON', 'entitlementId', 'entitlement', `/subscriptions/entitlements/${id}`],
      ['MEMBERSHIP_ENTITLEMENT_EXPIRED', 'entitlementId', 'entitlement', `/subscriptions/entitlements/${id}`],
      ['MEMBERSHIP_ENTITLEMENT_RENEWAL_SUCCESS', 'entitlementId', 'entitlement', `/subscriptions/entitlements/${id}`],
      ['VIP_EXPIRED', 'subscriptionId', 'subscription', `/subscriptions/${id}`],
      ['SUBSCRIPTION_RENEWAL_SUCCESS', 'subscriptionId', 'subscription', `/subscriptions/${id}`],
    ]) {
      const path = getSafeCustomerNotificationLink({ type: 'SYSTEM', priority: 'WARNING', metadata: { eventType, [field]: id, expiryCycle: '2030-01-03T00:00:00.000Z' } });
      const reload = new URL(path, 'https://valo.test');
      assert.equal(reload.pathname, '/customer/membership-transfers');
      await membership.getMembershipDetail(kind, reload.searchParams.get(field));
      assert.ok(requests.at(-1).url.endsWith(`${endpoint}/details`));
      await membership.getMembershipRenewalHistory(kind, id, 2);
      assert.ok(requests.at(-1).url.endsWith(`${endpoint}/renewals?page=2&limit=10`));
      assert.equal(requests.at(-1).options.headers.Authorization, 'Bearer fixture-token');
    }
    const path = getSafeCustomerNotificationLink({ type: 'BOOKING', metadata: { eventType: 'BOOKING_SUCCESS', bookingId: id } });
    assert.equal(new URL(path, 'https://valo.test').searchParams.get('bookingId'), id);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousStorage === undefined) delete globalThis.localStorage; else globalThis.localStorage = previousStorage;
    await server.close();
  }
});
