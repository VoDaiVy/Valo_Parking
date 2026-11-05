const User = require('../models/User');

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const BATCH_SIZE = 100;

function isExpoPushToken(value) {
  return typeof value === 'string' && /^Expo(nent)?PushToken\[.+\]$/.test(value.trim());
}

function normalizeData(data = {}) {
  return Object.fromEntries(
    Object.entries(data).filter(([, value]) => value !== undefined && value !== null).map(([key, value]) => [
      key,
      typeof value === 'object' ? JSON.stringify(value) : String(value),
    ])
  );
}

function buildMessages(tokens, notification) {
  return tokens.map((to) => ({
    to,
    title: notification.title,
    body: notification.content,
    sound: 'default',
    priority: notification.priority === 'ERROR' || notification.priority === 'WARNING' ? 'high' : 'default',
    channelId: 'valo-notifications',
    data: normalizeData({
      id: notification._id,
      type: notification.type,
      priority: notification.priority,
      ...(notification.metadata || {}),
    }),
  }));
}

async function postBatch(messages) {
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (process.env.EXPO_PUSH_ACCESS_TOKEN) {
    headers.Authorization = `Bearer ${process.env.EXPO_PUSH_ACCESS_TOKEN}`;
  }
  const response = await fetch(EXPO_PUSH_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(messages),
  });
  if (!response.ok) throw new Error(`Expo Push API returned HTTP ${response.status}`);
  return response.json();
}

async function sendPushNotification(userId, notification) {
  if (process.env.EXPO_PUSH_ENABLED === 'false') return { sent: 0, skipped: true };

  const user = await User.findById(userId).select('_id expoPushTokens').lean();
  const tokens = [...new Set((user?.expoPushTokens || []).filter(isExpoPushToken))];
  if (!tokens.length) return { sent: 0, skipped: true };

  let sent = 0;
  const invalidTokens = [];
  for (let index = 0; index < tokens.length; index += BATCH_SIZE) {
    const batch = tokens.slice(index, index + BATCH_SIZE);
    const result = await postBatch(buildMessages(batch, notification));
    const tickets = Array.isArray(result?.data) ? result.data : [];
    tickets.forEach((ticket, ticketIndex) => {
      if (ticket?.status === 'ok') sent += 1;
      if (ticket?.details?.error === 'DeviceNotRegistered') invalidTokens.push(batch[ticketIndex]);
    });
  }

  if (invalidTokens.length) {
    await User.findByIdAndUpdate(userId, { $pull: { expoPushTokens: { $in: invalidTokens } } });
  }
  return { sent, invalidTokens: invalidTokens.length };
}

module.exports = { EXPO_PUSH_URL, isExpoPushToken, normalizeData, buildMessages, sendPushNotification };
