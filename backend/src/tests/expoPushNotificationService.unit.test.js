const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildMessages, isExpoPushToken } = require('../services/expoPushNotificationService');

test('INFO alerts use high delivery priority and the configured Android channel', () => {
  const [message] = buildMessages(['ExpoPushToken[test]'], {
    _id: 'notice-1', title: 'Booking confirmed', content: 'Your space is ready',
    type: 'BOOKING', priority: 'INFO', metadata: { bookingId: 'booking-1' },
  });
  assert.equal(message.channelId, 'valo-notifications');
  assert.equal(message.priority, 'high');
  assert.equal(message.sound, 'default');
  assert.equal(message.data.id, 'notice-1');
  assert.equal(message.data.bookingId, 'booking-1');
});

test('accepts Expo tokens and rejects arbitrary values', () => {
  assert.equal(isExpoPushToken('ExpoPushToken[test]'), true);
  assert.equal(isExpoPushToken('ExponentPushToken[test]'), true);
  assert.equal(isExpoPushToken('invalid'), false);
});
