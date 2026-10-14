const Notification = require('../models/Notification');
const notificationService = require('./notificationService');
const { emitNotification } = require('../sockets/notificationSocket');

async function findDraftNotification(aiDraftId) {
  if (!aiDraftId) return null;
  return Notification.findOne({ 'metadata.aiDraftId': String(aiDraftId) });
}

async function sendSingleUserNotification({
  io,
  targetUserId,
  title,
  content,
  type = 'SYSTEM',
  priority = 'INFO',
  createdBy,
  aiDraftId,
}) {
  const existing = await findDraftNotification(aiDraftId);
  if (existing) return { notification: existing, created: false };

  let notification;
  try {
    notification = await notificationService.createForUser(
      targetUserId,
      {
        title,
        content,
        type,
        priority,
        metadata: aiDraftId ? { aiDraftId: String(aiDraftId) } : {},
      },
      createdBy,
      { requireActive: true }
    );
  } catch (error) {
    if (error.code !== 11000 || !aiDraftId) throw error;
    notification = await findDraftNotification(aiDraftId);
    if (!notification) throw error;
    return { notification, created: false };
  }

  if (io) await emitNotification(io, notification.targetUsers[0], notification);
  return { notification, created: true };
}

module.exports = { findDraftNotification, sendSingleUserNotification };
