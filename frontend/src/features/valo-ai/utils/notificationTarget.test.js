import test from 'node:test';
import assert from 'node:assert/strict';
import { notificationTarget, notificationClickTarget } from './notificationTarget.js';

test('VALO AI navigates only to known Admin notification targets', () => {
  assert.equal(notificationTarget('/admin/parking-lots'), '/admin/parking-lots');
  assert.equal(notificationTarget('/admin/bookings'), '/admin/bookings');
  assert.equal(notificationTarget('/admin/revenue'), '/admin/revenue');
  assert.equal(notificationTarget('/admin/vehicle-models?vehicleId=507f1f77bcf86cd799439011'), '/admin/vehicle-models?vehicleId=507f1f77bcf86cd799439011');
  assert.equal(notificationTarget(undefined), null);
  assert.equal(notificationTarget('/staff/bookings'), null);
  assert.equal(notificationTarget('https://example.com'), null);
});

const sessionId = '507f1f77bcf86cd799439011';
const route = `/admin/sessions?sessionId=${sessionId}`;
const notice = { notificationType: 'NEW_SESSION', entityId: sessionId, targetRoute: route };

test('Admin session route preserves the exact valid query and identifies the session by ID', () => {
  assert.equal(notificationTarget(route), route);
  assert.equal(notificationClickTarget({ ...notice, licensePlate: 'irrelevant', slot: 'irrelevant' }, 'admin'), route);
  assert.equal(notificationTarget(`${route}&context=notification`), `${route}&context=notification`);
});

test('external URLs, redirect-like paths, invalid IDs and disallowed routes are rejected', () => {
  for (const target of [
    `https://example.com${route}`, `//example.com${route}`, '/admin/unknown',
    '/admin/sessions/../revenue', '/admin/sessions', '/admin/sessions?sessionId=invalid',
    `${route}&sessionId=${sessionId}`, `${route}#fragment`, `/admin/sessions\\?sessionId=${sessionId}`,
    null, {},
  ]) assert.equal(notificationTarget(target), null);
});

test('invalid notification targets return the detail fallback decision', () => {
  assert.equal(notificationClickTarget({ ...notice, targetRoute: undefined }, 'admin'), null);
  assert.equal(notificationClickTarget({ ...notice, targetRoute: 'https://example.com' }, 'admin'), null);
  assert.equal(notificationClickTarget({ ...notice, entityId: '507f1f77bcf86cd799439012' }, 'admin'), null);
});

test('Staff NEW_SESSION and other session event navigation remain unchanged', () => {
  assert.equal(notificationClickTarget(notice, 'staff'), null);
  assert.equal(notificationClickTarget({ ...notice, notificationType: 'SESSION_OVERDUE' }, 'admin'), null);
});

test('existing booking navigation and other allowed targets are preserved', () => {
  const booking = { notificationType: 'NEW_BOOKING', entityType: 'booking', entityId: sessionId, targetRoute: '/admin/bookings' };
  assert.equal(notificationClickTarget(booking, 'admin'), `/admin/parking-lots?bookingId=${sessionId}`);
  assert.equal(notificationClickTarget(booking, 'staff'), `/staff/parking-lots?bookingId=${sessionId}`);
  const currentRoute = `/admin/parking-lots?bookingId=${sessionId}`;
  assert.equal(notificationClickTarget({ ...booking, targetRoute: currentRoute }, 'admin'), currentRoute);
  assert.equal(notificationClickTarget({ targetRoute: '/admin/revenue' }, 'admin'), '/admin/revenue');
});

test('Admin subscription navigation normalizes legacy entityId and evidence IDs without changing Staff', () => {
  const item = { notificationType: 'NEW_SUBSCRIPTION', entityId: sessionId, targetRoute: '/admin/subscriptions' };
  assert.equal(notificationClickTarget(item, 'admin'), `/admin/subscriptions?subscriptionId=${sessionId}`);
  assert.equal(notificationClickTarget(item, 'staff'), null);
  assert.equal(notificationClickTarget({ ...item, entityId: undefined, evidence: { subscriptionId: sessionId } }, 'admin'), `/admin/subscriptions?subscriptionId=${sessionId}`);
  assert.equal(notificationClickTarget({ ...item, targetRoute: `/admin/subscriptions?subscriptionId=wrong` }, 'admin'), `/admin/subscriptions?subscriptionId=${sessionId}`);
  assert.equal(notificationClickTarget({ ...item, targetRoute: undefined }, 'admin'), `/admin/subscriptions?subscriptionId=${sessionId}`);
  assert.equal(notificationClickTarget({ ...item, entityId: 'bad' }, 'admin'), null);
  assert.equal(notificationClickTarget({ ...item, targetRoute: 'https://example.com' }, 'admin'), null);
  assert.equal(notificationClickTarget({ ...item, targetRoute: '/admin/revenue' }, 'admin'), null);
});
