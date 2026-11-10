const mongoose = require('mongoose');

// Membership only: log, notification, inbox and lifecycle guard commit together.
function createMembershipNotificationDelivery(deps = {}) {
  const Log = deps.Log || require('../models/NotificationEventLog');
  const Notification = deps.Notification || require('../models/Notification');
  const Inbox = deps.Inbox || require('../models/UserNotification');
  const User = deps.User || require('../models/User');
  const startSession = deps.startSession || (() => mongoose.startSession());

  async function deliver(eventType, referenceId, userId, data, guard) {
    const session = await startSession();
    let result = null;
    try {
      await session.withTransaction(async () => {
        result = null; // The driver may retry this callback.
        if (guard && !await guard(session)) return;
        const log = await Log.findOne({ eventType, referenceId }).session(session).lean();
        const identity = {
          'metadata.eventType': eventType, 'metadata.referenceId': referenceId,
          targetType: 'SINGLE_USER', targetUsers: userId, priority: data.priority,
          isRevoked: { $ne: true },
          ...(data.metadata.expiryCycle && { 'metadata.expiryCycle': data.metadata.expiryCycle }),
          ...(data.metadata.entitlementId && { 'metadata.entitlementId': data.metadata.entitlementId }),
          ...(data.metadata.subscriptionId && { 'metadata.subscriptionId': data.metadata.subscriptionId }),
        };
        if (log?.notificationId) {
          const existing = await Notification.findOne({ _id: log.notificationId, ...identity }).session(session);
          if (existing) {
            await Inbox.updateOne({ userId, notificationId: existing._id }, {
              $setOnInsert: { userId, notificationId: existing._id, isRead: false, isDeleted: false },
            }, { upsert: true, session });
            return;
          }
        }
        const user = await User.findOne({ _id: userId }).select('_id').session(session).lean();
        if (!user) throw new Error('Membership notification recipient is unavailable.');
        // Recover legacy interrupted deliveries without resetting read/deleted flags.
        let notification = await Notification.findOne(identity).session(session);
        if (!notification) {
          [notification] = await Notification.create([{
            ...data, targetType: 'SINGLE_USER', targetUsers: [userId],
            createdBy: null, recipientCount: 1,
          }], { session });
        }
        await Inbox.updateOne({ userId, notificationId: notification._id }, {
          $setOnInsert: { userId, notificationId: notification._id, isRead: false, isDeleted: false },
        }, { upsert: true, session });
        await Log.updateOne({ eventType, referenceId }, {
          $set: { notificationId: notification._id }, $setOnInsert: { eventType, referenceId },
        }, { upsert: true, session });
        result = notification;
      });
      return result;
    } catch (error) {
      if (error.code === 11000) {
        // Only a completed competing transaction counts as delivered.
        const completed = await Log.findOne({ eventType, referenceId }).lean();
        if (completed?.notificationId) return null;
      }
      throw error;
    } finally { await session.endSession(); }
  }
  return { deliver };
}

module.exports = { ...createMembershipNotificationDelivery(), createMembershipNotificationDelivery };
