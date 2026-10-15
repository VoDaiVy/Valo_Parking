const { emitNotification } = require('../sockets/notificationSocket');

// Database notifications are authoritative; sockets are a best-effort live update.
function publishNotifications(app, notifications) {
  const io = app?.get?.('io');
  if (!io) return;
  for (const notification of notifications) {
    for (const userId of notification.targetUsers) {
      Promise.resolve(emitNotification(io, userId, notification, { notifyAdmins: false, includeAudience: false }))
        .catch((error) => console.error('[Rewards] Live notification failed:', error.message));
    }
  }
}
module.exports = { publishNotifications };
