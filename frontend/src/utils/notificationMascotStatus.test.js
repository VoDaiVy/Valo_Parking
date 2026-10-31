import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { NOTIFICATION_STATUSES, NOTIFICATION_MASCOTS, resolveNotificationMascotStatus } from './notificationMascotStatus.js';
import { notificationFromSocket } from './notificationSocketPayload.js';

// Reconstructed contract fixture, NOT captured production data:
// Staff/NotificationManagement.ComposeTab -> controller -> Notification schema;
// notificationService.getUserNotifications projection -> useNotifications;
// real socket emitter -> notificationFromSocket used by that same hook.
const fixture = JSON.parse(readFileSync(new URL('./__fixtures__/manualErrorNotification.json', import.meta.url), 'utf8'));
const require = createRequire(import.meta.url);
const Notification = require('../../../backend/src/models/Notification.js');
const UserNotification = require('../../../backend/src/models/UserNotification.js');
const notificationService = require('../../../backend/src/services/notificationService.js');
const socketService = require('../../../backend/src/sockets/notificationSocket.js');

test('manual SYSTEM/ERROR survives actual schema, inbox row, socket producer and hook adapter', async () => {
  const document = new Notification({
    ...fixture.createRequest,
    _id: fixture.inboxResponse.data[0].notificationId,
    createdBy: '507f1f77bcf86cd799439014',
    createdAt: new Date(fixture.inboxResponse.data[0].notificationCreatedAt),
  });
  assert.equal(document.validateSync(), undefined);
  assert.equal(document.priority, 'ERROR');
  assert.deepEqual(document.metadata, {});
  assert.equal(resolveNotificationMascotStatus(document.toObject()), 'ERROR');
  const row = fixture.inboxResponse.data[0];
  assert.equal(row.priority, document.priority);
  assert.equal(resolveNotificationMascotStatus(row), 'ERROR');
  const originalAggregate = UserNotification.aggregate;
  const pipelines = [];
  try {
    UserNotification.aggregate = async (pipeline) => {
      pipelines.push(pipeline);
      return pipeline.some((stage) => stage.$count)
        ? [{ total: 1 }]
        : structuredClone(fixture.inboxResponse.data);
    };
    const result = await notificationService.getUserNotifications(fixture.createRequest.targetUsers[0]);
    const projection = pipelines[1].find((stage) => stage.$project).$project;
    assert.equal(projection.priority, '$notification.priority');
    assert.equal(projection.metadata, '$notification.metadata');
    assert.equal(resolveNotificationMascotStatus(result.notifications[0]), 'ERROR');
  } finally {
    UserNotification.aggregate = originalAggregate;
  }
  const events = [];
  const io = { to: () => ({ emit: (event, payload) => events.push({ event, payload }) }) };
  const userId = fixture.createRequest.targetUsers[0];
  socketService.onlineUsers.set(userId, new Set(['fixture-socket']));
  try {
    // In-memory socket double, no database connection or external sends.
    await socketService.emitNotification(io, userId, document, { notifyAdmins: false, updateUnreadCount: false });
    assert.equal(events.length, 1);
    assert.equal(events[0].event, 'notification:new');
    const normalized = notificationFromSocket(events[0].payload, 1);
    assert.equal(normalized.priority, 'ERROR');
    assert.equal(resolveNotificationMascotStatus(normalized), 'ERROR');
    assert.equal(NOTIFICATION_MASCOTS[resolveNotificationMascotStatus(normalized)].image, 'error');
  } finally {
    socketService.onlineUsers.delete(userId);
  }
});

test('all five explicit statuses win over business type, channel and conflicting events', () => {
  for (const status of NOTIFICATION_STATUSES) {
    for (const value of [status, status.toLowerCase(), ` ${status.toLowerCase()} `]) {
      assert.equal(resolveNotificationMascotStatus({
        ...fixture.inboxResponse.data[0], priority: value, type: 'SYSTEM',
        channels: ['IN_APP'], status: 'SENT',
        metadata: { eventType: status === 'ERROR' ? 'SYSTEM_UPDATE' : 'PAYMENT_FAILED' },
      }), status);
    }
  }
});

test('event-only legacy records use exact mappings and centralized case normalization', () => {
  for (const [eventType, status] of [
    [' subscription_renewal_success ', 'SUCCESS'], ['VIP_EXPIRING_SOON', 'WARNING'],
    ['VIP_EXPIRED', 'WARNING'], ['PAYMENT_FAILED', 'ERROR'],
    ['SYSTEM_MAINTENANCE', 'SYSTEM'], ['SYSTEM_UPDATE', 'SYSTEM'],
    ['TRANSFER_REQUEST_CREATED', 'INFO'], ['BOOKING_ENDING_5', 'WARNING'],
    ['SUBSCRIPTION_RENEWAL_WINDOW_NOT_OPEN', 'WARNING'],
  ]) {
    assert.equal(resolveNotificationMascotStatus({ type: 'SYSTEM', metadata: { eventType } }), status);
  }
});

test('unknown records fall back: urgency, delivery status, automatic origin and text are not presentation status', () => {
  for (const notification of [null, {}, { priority: 'HIGH' }, { priority: 'URGENT' },
    { type: 'SYSTEM', createdBy: null }, { status: 'FAILED', channels: ['SYSTEM'] },
    { title: 'ERROR successful renewal', content: 'System failed!' },
    { metadata: { eventType: 'UNKNOWN' } }]) {
    assert.equal(resolveNotificationMascotStatus(notification), 'INFO');
  }
  assert.equal(resolveNotificationMascotStatus({ priority: 'HIGH', metadata: { eventType: 'PAYMENT_FAILED' } }), 'ERROR');
});
