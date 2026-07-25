const notificationService = require('./notificationService');
const notificationEmailService = require('./notificationEmailService');
const { emitNotification, broadcastNotification } = require('../sockets/notificationSocket');
const NotificationRule = require('../models/NotificationRule');
const Notification = require('../models/Notification');
const User = require('../models/User');
const MembershipEntitlementTransfer = require('../models/MembershipEntitlementTransfer');

/**
 * Notification Trigger Helpers
 *
 * Each function:
 * 1. Checks if the corresponding auto-rule is enabled in DB
 * 2. Creates an auto-notification with deduplication
 * 3. Emits via Socket.IO if user is online
 * 4. If user is offline, notification is still saved in DB
 * 5. Updates lastTriggeredAt on the rule
 *
 * Usage: const triggers = require('../services/notificationTriggers');
 *        await triggers.notifyRegistrationSuccess(req.app, userId);
 *
 * All functions are fire-and-forget safe — they catch errors internally
 * to avoid breaking the calling controller flow.
 */

// ─── Helper to get io from app ──────────────────────────────────────────────────
function getIO(app) {
  return app ? app.get('io') : null;
}

function queueNotificationEmail(userId, eventKey, templateData = {}) {
  notificationEmailService.sendNotificationEmail(userId, eventKey, templateData);
}

function queueBroadcastEmail(userIds, eventKey, templateData = {}) {
  notificationEmailService.sendBroadcastNotificationEmail(userIds, eventKey, templateData);
}

// ─── Helper: check if a rule is enabled ─────────────────────────────────────────
async function isRuleEnabled(eventKey) {
  try {
    const rule = await NotificationRule.findOne({ eventKey });
    // If no rule exists in DB, default to enabled (backwards compatible)
    if (!rule) return true;
    return rule.enabled;
  } catch (err) {
    // On DB error, default to enabled so we don't silently drop notifications
    console.error(`[NotifTrigger] isRuleEnabled error for ${eventKey}:`, err.message);
    return true;
  }
}

// Helper: check enabled + throttle for a rule
async function shouldTriggerRule(eventKey, userId = null, eventType = null) {
  try {
    const rule = await NotificationRule.findOne({ eventKey });
    if (!rule) return true;
    if (!rule.enabled) return false;

    const throttleMinutes = Number(rule.throttleMinutes) || 0;
    if (throttleMinutes <= 0) return true;

    const since = new Date(Date.now() - throttleMinutes * 60 * 1000);

    if (userId && eventType) {
      const recentNotification = await Notification.exists({
        targetUsers: userId,
        'metadata.eventType': eventType,
        createdAt: { $gte: since },
        isRevoked: false,
      });
      return !recentNotification;
    }

    if (rule.lastTriggeredAt && rule.lastTriggeredAt >= since) {
      return false;
    }

    return true;
  } catch (err) {
    console.error(`[NotifTrigger] shouldTriggerRule error for ${eventKey}:`, err.message);
    return true;
  }
}

// ─── Helper: update lastTriggeredAt on rule ─────────────────────────────────────
async function updateRuleLastTriggered(eventKey) {
  try {
    await NotificationRule.findOneAndUpdate(
      { eventKey },
      { lastTriggeredAt: new Date() }
    );
  } catch (err) {
    // Non-critical, just log
    console.error(`[NotifTrigger] updateRuleLastTriggered error:`, err.message);
  }
}

// ─── ACCOUNT ────────────────────────────────────────────────────────────────────

async function notifyRegistrationSuccess(app, userId) {
  try {
    if (!(await shouldTriggerRule('account.registered', userId, 'REGISTRATION_SUCCESS'))) return;

    const notification = await notificationService.createAutoNotification(
      'REGISTRATION_SUCCESS',
      `user_${userId}_register`,
      userId,
      'REGISTRATION_SUCCESS'
    );
    if (notification) {
      const io = getIO(app);
      if (io) await emitNotification(io, userId, notification);
      queueNotificationEmail(userId, 'account.registered');
      await updateRuleLastTriggered('account.registered');
    }
  } catch (err) {
    console.error('[NotifTrigger] notifyRegistrationSuccess error:', err.message);
  }
}

async function notifyEmailVerified(app, userId) {
  try {
    if (!(await shouldTriggerRule('account.email_verified', userId, 'EMAIL_VERIFIED'))) return;

    const notification = await notificationService.createAutoNotification(
      'EMAIL_VERIFIED',
      `user_${userId}_email_verified`,
      userId,
      'EMAIL_VERIFIED'
    );
    if (notification) {
      const io = getIO(app);
      if (io) await emitNotification(io, userId, notification);
      await updateRuleLastTriggered('account.email_verified');
    }
  } catch (err) {
    console.error('[NotifTrigger] notifyEmailVerified error:', err.message);
  }
}

async function notifyPasswordChanged(app, userId) {
  try {
    if (!(await shouldTriggerRule('account.password_changed', userId, 'PASSWORD_CHANGED'))) return;

    const refId = `user_${userId}_pwd_${Date.now()}`;
    const notification = await notificationService.createAutoNotification(
      'PASSWORD_CHANGED',
      refId,
      userId,
      'PASSWORD_CHANGED'
    );
    if (notification) {
      const io = getIO(app);
      if (io) await emitNotification(io, userId, notification);
      await updateRuleLastTriggered('account.password_changed');
    }
  } catch (err) {
    console.error('[NotifTrigger] notifyPasswordChanged error:', err.message);
  }
}

async function notifyAccountLocked(app, userId) {
  try {
    if (!(await shouldTriggerRule('account.locked', userId, 'ACCOUNT_LOCKED'))) return;

    const notification = await notificationService.createAutoNotification(
      'ACCOUNT_LOCKED',
      `user_${userId}_locked_${Date.now()}`,
      userId,
      'ACCOUNT_LOCKED'
    );
    if (notification) {
      const io = getIO(app);
      if (io) await emitNotification(io, userId, notification);
      await updateRuleLastTriggered('account.locked');
    }
  } catch (err) {
    console.error('[NotifTrigger] notifyAccountLocked error:', err.message);
  }
}

async function notifyAccountUnlocked(app, userId) {
  try {
    if (!(await shouldTriggerRule('account.unlocked', userId, 'ACCOUNT_UNLOCKED'))) return;

    const notification = await notificationService.createAutoNotification(
      'ACCOUNT_UNLOCKED',
      `user_${userId}_unlocked_${Date.now()}`,
      userId,
      'ACCOUNT_UNLOCKED'
    );
    if (notification) {
      const io = getIO(app);
      if (io) await emitNotification(io, userId, notification);
      await updateRuleLastTriggered('account.unlocked');
    }
  } catch (err) {
    console.error('[NotifTrigger] notifyAccountUnlocked error:', err.message);
  }
}

// ─── WALLET ─────────────────────────────────────────────────────────────────────

async function notifyTopUpSuccess(app, userId, amount, balance) {
  try {
    if (!(await shouldTriggerRule('wallet.topup_success', userId, 'TOPUP_SUCCESS'))) return;

    const fmtAmount = Number(amount).toLocaleString('vi-VN');
    const fmtBalance = Number(balance).toLocaleString('vi-VN');
    const notification = await notificationService.createAutoNotification(
      'TOPUP_SUCCESS',
      `user_${userId}_topup_${Date.now()}`,
      userId,
      'TOPUP_SUCCESS',
      { amount: fmtAmount, balance: fmtBalance }
    );
    if (notification) {
      const io = getIO(app);
      if (io) await emitNotification(io, userId, notification);
      queueNotificationEmail(userId, 'wallet.topup_success', {
        amount: fmtAmount,
        balance: fmtBalance,
      });
      await updateRuleLastTriggered('wallet.topup_success');
    }
  } catch (err) {
    console.error('[NotifTrigger] notifyTopUpSuccess error:', err.message);
  }
}

async function notifyTopUpFailed(app, userId, amount) {
  try {
    if (!(await shouldTriggerRule('wallet.topup_failed', userId, 'TOPUP_FAILED'))) return;

    const fmtAmount = Number(amount).toLocaleString('vi-VN');
    const notification = await notificationService.createAutoNotification(
      'TOPUP_FAILED',
      `user_${userId}_topup_fail_${Date.now()}`,
      userId,
      'TOPUP_FAILED',
      { amount: fmtAmount }
    );
    if (notification) {
      const io = getIO(app);
      if (io) await emitNotification(io, userId, notification);
      queueNotificationEmail(userId, 'wallet.topup_failed', { amount: fmtAmount });
      await updateRuleLastTriggered('wallet.topup_failed');
    }
  } catch (err) {
    console.error('[NotifTrigger] notifyTopUpFailed error:', err.message);
  }
}

async function notifyRefundSuccess(app, userId, amount, balance) {
  try {
    if (!(await shouldTriggerRule('wallet.refund_success', userId, 'REFUND_SUCCESS'))) return;

    const fmtAmount = Number(amount).toLocaleString('vi-VN');
    const fmtBalance = Number(balance).toLocaleString('vi-VN');
    const notification = await notificationService.createAutoNotification(
      'REFUND_SUCCESS',
      `user_${userId}_refund_${Date.now()}`,
      userId,
      'REFUND_SUCCESS',
      { amount: fmtAmount, balance: fmtBalance }
    );
    if (notification) {
      const io = getIO(app);
      if (io) await emitNotification(io, userId, notification);
      await updateRuleLastTriggered('wallet.refund_success');
    }
  } catch (err) {
    console.error('[NotifTrigger] notifyRefundSuccess error:', err.message);
  }
}

async function notifyLowBalance(app, userId, balance) {
  try {
    if (!(await shouldTriggerRule('wallet.low_balance', userId, 'LOW_BALANCE'))) return;

    const fmtBalance = Number(balance).toLocaleString('vi-VN');
    const notification = await notificationService.createAutoNotification(
      'LOW_BALANCE',
      `user_${userId}_lowbal_${Math.floor(Date.now() / 86400000)}`,
      userId,
      'LOW_BALANCE',
      { balance: fmtBalance }
    );
    if (notification) {
      const io = getIO(app);
      if (io) await emitNotification(io, userId, notification);
      await updateRuleLastTriggered('wallet.low_balance');
    }
  } catch (err) {
    console.error('[NotifTrigger] notifyLowBalance error:', err.message);
  }
}

// ─── PAYMENT ────────────────────────────────────────────────────────────────────

async function notifyPaymentSuccess(app, userId, amount, sessionId) {
  try {
    if (!(await shouldTriggerRule('wallet.payment_success', userId, 'PAYMENT_SUCCESS'))) return;

    const fmtAmount = Number(amount).toLocaleString('vi-VN');
    const notification = await notificationService.createAutoNotification(
      'PAYMENT_SUCCESS',
      `session_${sessionId}_payment`,
      userId,
      'PAYMENT_SUCCESS',
      { amount: fmtAmount }
    );
    if (notification) {
      const io = getIO(app);
      if (io) await emitNotification(io, userId, notification);
      queueNotificationEmail(userId, 'wallet.payment_success', { amount: fmtAmount });
      await updateRuleLastTriggered('wallet.payment_success');
    }
  } catch (err) {
    console.error('[NotifTrigger] notifyPaymentSuccess error:', err.message);
  }
}

async function notifyPaymentFailed(app, userId, amount) {
  try {
    if (!(await shouldTriggerRule('wallet.payment_failed', userId, 'PAYMENT_FAILED'))) return;

    const fmtAmount = Number(amount).toLocaleString('vi-VN');
    const notification = await notificationService.createAutoNotification(
      'PAYMENT_FAILED',
      `user_${userId}_payfail_${Date.now()}`,
      userId,
      'PAYMENT_FAILED',
      { amount: fmtAmount }
    );
    if (notification) {
      const io = getIO(app);
      if (io) await emitNotification(io, userId, notification);
      await updateRuleLastTriggered('wallet.payment_failed');
    }
  } catch (err) {
    console.error('[NotifTrigger] notifyPaymentFailed error:', err.message);
  }
}

async function notifyViolationCreated(app, userId, violationData = {}) {
  try {
    if (!(await shouldTriggerRule('violation.created', userId, 'VIOLATION_CREATED'))) return;

    const fmtAmount = Number(violationData.amount || 0).toLocaleString('vi-VN');
    const violationId = violationData.violationId || Date.now();
    const templateData = {
      title: violationData.title || 'Parking violation',
      amount: fmtAmount,
      violationId,
    };
    const notification = await notificationService.createAutoNotification(
      'VIOLATION_CREATED',
      `violation_${violationId}_created`,
      userId,
      'VIOLATION_CREATED',
      templateData
    );
    if (notification) {
      const io = getIO(app);
      if (io) await emitNotification(io, userId, notification);
      queueNotificationEmail(userId, 'violation.created', templateData);
      await updateRuleLastTriggered('violation.created');
    }
  } catch (err) {
    console.error('[NotifTrigger] notifyViolationCreated error:', err.message);
  }
}

async function notifyViolationPaymentReminder(app, userId, violationId) {
  try {
    if (!(await shouldTriggerRule('violation.payment_reminder', userId, 'VIOLATION_PAYMENT_REMINDER'))) return;

    const notification = await notificationService.createAutoNotification(
      'VIOLATION_PAYMENT_REMINDER',
      `violation_${violationId}_reminder_${Math.floor(Date.now() / 86400000)}`,
      userId,
      'VIOLATION_PAYMENT_REMINDER',
      { violationId }
    );
    if (notification) {
      const io = getIO(app);
      if (io) await emitNotification(io, userId, notification);
      await updateRuleLastTriggered('violation.payment_reminder');
    }
  } catch (err) {
    console.error('[NotifTrigger] notifyViolationPaymentReminder error:', err.message);
  }
}

async function notifyViolationPaid(app, userId, violationId, amount) {
  try {
    if (!(await shouldTriggerRule('violation.paid', userId, 'VIOLATION_PAID'))) return;

    const fmtAmount = Number(amount || 0).toLocaleString('vi-VN');
    const templateData = { violationId, amount: fmtAmount };
    const notification = await notificationService.createAutoNotification(
      'VIOLATION_PAID',
      `violation_${violationId}_paid`,
      userId,
      'VIOLATION_PAID',
      templateData
    );
    if (notification) {
      const io = getIO(app);
      if (io) await emitNotification(io, userId, notification);
      queueNotificationEmail(userId, 'violation.paid', templateData);
      await updateRuleLastTriggered('violation.paid');
    }
  } catch (err) {
    console.error('[NotifTrigger] notifyViolationPaid error:', err.message);
  }
}

async function notifyViolationCancelled(app, userId, violationId) {
  try {
    if (!(await shouldTriggerRule('violation.cancelled', userId, 'VIOLATION_CANCELLED'))) return;

    const notification = await notificationService.createAutoNotification(
      'VIOLATION_CANCELLED',
      `violation_${violationId}_cancelled`,
      userId,
      'VIOLATION_CANCELLED',
      { violationId }
    );
    if (notification) {
      const io = getIO(app);
      if (io) await emitNotification(io, userId, notification);
      await updateRuleLastTriggered('violation.cancelled');
    }
  } catch (err) {
    console.error('[NotifTrigger] notifyViolationCancelled error:', err.message);
  }
}

// ─── BOOKING ────────────────────────────────────────────────────────────────────

async function notifyBookingSuccess(app, userId, bookingDetails = {}) {
  try {
    if (!(await shouldTriggerRule('booking.created', userId, 'BOOKING_SUCCESS'))) return;

    const notification = await notificationService.createAutoNotification(
      'BOOKING_SUCCESS',
      `booking_${bookingDetails.bookingId || Date.now()}_created`,
      userId,
      'BOOKING_SUCCESS',
      { slotInfo: bookingDetails.slotInfo || 'N/A' }
    );
    if (notification) {
      const io = getIO(app);
      if (io) await emitNotification(io, userId, notification);
      queueNotificationEmail(userId, 'booking.created', {
        slotInfo: bookingDetails.slotInfo || 'N/A',
        bookingId: bookingDetails.bookingId,
      });
      await updateRuleLastTriggered('booking.created');
    }
  } catch (err) {
    console.error('[NotifTrigger] notifyBookingSuccess error:', err.message);
  }
}

async function notifyBookingCancelled(app, userId, bookingDetails = {}) {
  try {
    if (!(await shouldTriggerRule('booking.cancelled', userId, 'BOOKING_CANCELLED'))) return;

    const notification = await notificationService.createAutoNotification(
      'BOOKING_CANCELLED',
      `booking_${bookingDetails.bookingId || Date.now()}_cancelled`,
      userId,
      'BOOKING_CANCELLED',
      {
        slotInfo: bookingDetails.slotInfo || 'N/A',
        reason: bookingDetails.reason || '',
      }
    );
    if (notification) {
      const io = getIO(app);
      if (io) await emitNotification(io, userId, notification);
      queueNotificationEmail(userId, 'booking.cancelled', {
        slotInfo: bookingDetails.slotInfo || 'N/A',
        reason: bookingDetails.reason || '',
        bookingId: bookingDetails.bookingId,
      });
      await updateRuleLastTriggered('booking.cancelled');
    }
  } catch (err) {
    console.error('[NotifTrigger] notifyBookingCancelled error:', err.message);
  }
}

function bookingTimestamp(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'unknown' : String(date.getTime());
}

async function createDirectBookingNotification(
  app,
  userId,
  bookingDetails,
  { eventType, referenceSuffix, templateKey, templateData = {} }
) {
  if (!userId || !bookingDetails?.bookingId) return null;

  const notification = await notificationService.createAutoNotification(
    eventType,
    `booking_${bookingDetails.bookingId}_${referenceSuffix}`,
    userId,
    templateKey,
    {
      bookingId: String(bookingDetails.bookingId),
      slotInfo: bookingDetails.slotInfo || 'N/A',
      scheduledStart: bookingDetails.scheduledStart,
      scheduledEnd: bookingDetails.scheduledEnd,
      ...templateData,
    }
  );

  if (notification) {
    const io = getIO(app);
    if (io) await emitNotification(io, userId, notification);
  }

  return notification;
}

async function notifyBookingCheckinReminder(app, userId, bookingDetails, minutesLeft) {
  try {
    if (![30, 15].includes(minutesLeft)) return null;
    const scheduleKey = bookingTimestamp(bookingDetails?.scheduledStart);
    return await createDirectBookingNotification(app, userId, bookingDetails, {
      eventType: `BOOKING_CHECKIN_REMINDER_${minutesLeft}`,
      referenceSuffix: `checkin_${minutesLeft}_${scheduleKey}`,
      templateKey: 'BOOKING_CHECKIN_REMINDER',
      templateData: { minutes: minutesLeft },
    });
  } catch (err) {
    console.error('[NotifTrigger] notifyBookingCheckinReminder error:', err.message);
    return null;
  }
}

async function notifyBookingCheckinExpired(app, userId, bookingDetails) {
  try {
    const scheduleKey = bookingTimestamp(bookingDetails?.scheduledStart);
    return await createDirectBookingNotification(app, userId, bookingDetails, {
      eventType: 'BOOKING_CHECKIN_EXPIRED',
      referenceSuffix: `checkin_expired_${scheduleKey}`,
      templateKey: 'BOOKING_CHECKIN_EXPIRED',
    });
  } catch (err) {
    console.error('[NotifTrigger] notifyBookingCheckinExpired error:', err.message);
    return null;
  }
}

async function notifyBookingEndingSoon(app, userId, bookingDetails, minutesLeft) {
  try {
    if (![30, 15, 5].includes(minutesLeft)) return null;
    const scheduleKey = bookingTimestamp(bookingDetails?.scheduledEnd);
    return await createDirectBookingNotification(app, userId, bookingDetails, {
      eventType: `BOOKING_ENDING_${minutesLeft}`,
      referenceSuffix: `ending_${minutesLeft}_${scheduleKey}`,
      templateKey: 'BOOKING_ENDING_SOON',
      templateData: { minutes: minutesLeft },
    });
  } catch (err) {
    console.error('[NotifTrigger] notifyBookingEndingSoon error:', err.message);
    return null;
  }
}

async function notifyBookingTimeExpired(app, userId, bookingDetails) {
  try {
    const scheduleKey = bookingTimestamp(bookingDetails?.scheduledEnd);
    return await createDirectBookingNotification(app, userId, bookingDetails, {
      eventType: 'BOOKING_TIME_EXPIRED',
      referenceSuffix: `time_expired_${scheduleKey}`,
      templateKey: 'BOOKING_TIME_EXPIRED',
    });
  } catch (err) {
    console.error('[NotifTrigger] notifyBookingTimeExpired error:', err.message);
    return null;
  }
}

async function notifyBookingNoShowCancelled(app, userId, bookingDetails) {
  try {
    const scheduleKey = bookingTimestamp(bookingDetails?.scheduledStart);
    return await createDirectBookingNotification(app, userId, bookingDetails, {
      eventType: 'BOOKING_NO_SHOW_CANCELLED',
      referenceSuffix: `no_show_cancelled_${scheduleKey}`,
      templateKey: 'BOOKING_NO_SHOW_CANCELLED',
    });
  } catch (err) {
    console.error('[NotifTrigger] notifyBookingNoShowCancelled error:', err.message);
    return null;
  }
}

async function createDirectSubscriptionNotification(
  app,
  userId,
  subscriptionDetails,
  { eventType, referenceSuffix, templateKey }
) {
  if (!userId || !subscriptionDetails?.subscriptionId) return null;

  const notification = await notificationService.createAutoNotification(
    eventType,
    `subscription_${subscriptionDetails.subscriptionId}_${referenceSuffix}`,
    userId,
    templateKey,
    {
      subscriptionId: String(subscriptionDetails.subscriptionId),
      expireAt: subscriptionDetails.expireAt,
      expireDate: subscriptionDetails.expireDate || 'N/A',
    }
  );

  if (notification) {
    const io = getIO(app);
    if (io) await emitNotification(io, userId, notification);
  }

  return notification;
}

async function notifyVipExpiringSoon(app, userId, subscriptionDetails) {
  try {
    const expirationKey = bookingTimestamp(subscriptionDetails?.expireAt);
    return await createDirectSubscriptionNotification(
      app,
      userId,
      subscriptionDetails,
      {
        eventType: 'VIP_EXPIRING_SOON',
        referenceSuffix: `expiring_${expirationKey}`,
        templateKey: 'VIP_EXPIRING_SOON',
      }
    );
  } catch (err) {
    console.error('[NotifTrigger] notifyVipExpiringSoon error:', err.message);
    return null;
  }
}

async function notifyVipExpired(app, userId, subscriptionDetails) {
  try {
    const expirationKey = bookingTimestamp(subscriptionDetails?.expireAt);
    return await createDirectSubscriptionNotification(
      app,
      userId,
      subscriptionDetails,
      {
        eventType: 'VIP_EXPIRED',
        referenceSuffix: `expired_${expirationKey}`,
        templateKey: 'VIP_EXPIRED',
      }
    );
  } catch (err) {
    console.error('[NotifTrigger] notifyVipExpired error:', err.message);
    return null;
  }
}

async function sendTransferNotification(app, userIds, eventType, templateKey, transfer, templateData = {}) {
  const ids = userIds.filter(Boolean).map(String);
  const io = getIO(app);

  await Promise.all(ids.map(async (userId) => {
    const notification = await notificationService.createAutoNotification(
      eventType,
      `transfer_${transfer._id}_${templateKey}_${userId}`,
      userId,
      templateKey,
      {
        transferId: transfer._id,
        ...templateData,
      }
    );
    if (notification && io) {
      await emitNotification(io, userId, notification);
    }
  }));
}

async function notifyTransferRequestCreated(app, transfer) {
  try {
    const fromUserId = transfer.fromUserId?._id || transfer.fromUserId;
    const toUserId = transfer.toUserId?._id || transfer.toUserId;
    if (!(await shouldTriggerRule('booking_transfer.created', fromUserId, 'TRANSFER_REQUEST_CREATED'))) return;
    await sendTransferNotification(
      app,
      [fromUserId, toUserId],
      'TRANSFER_REQUEST_CREATED',
      'TRANSFER_REQUEST_CREATED',
      transfer
    );
    await updateRuleLastTriggered('booking_transfer.created');
  } catch (err) {
    console.error('[NotifTrigger] notifyTransferRequestCreated error:', err.message);
  }
}

async function notifyTransferApproved(app, transfer) {
  try {
    const fromUserId = transfer.fromUserId?._id || transfer.fromUserId;
    const toUserId = transfer.toUserId?._id || transfer.toUserId;
    if (!(await shouldTriggerRule('booking_transfer.approved', fromUserId, 'TRANSFER_APPROVED'))) return;
    await sendTransferNotification(
      app,
      [fromUserId, toUserId],
      'TRANSFER_APPROVED',
      'TRANSFER_APPROVED',
      transfer
    );
    await updateRuleLastTriggered('booking_transfer.approved');
  } catch (err) {
    console.error('[NotifTrigger] notifyTransferApproved error:', err.message);
  }
}

async function notifyTransferRejected(app, transfer) {
  try {
    const fromUserId = transfer.fromUserId?._id || transfer.fromUserId;
    if (!(await shouldTriggerRule('booking_transfer.rejected', fromUserId, 'TRANSFER_REJECTED'))) return;
    await sendTransferNotification(
      app,
      [fromUserId],
      'TRANSFER_REJECTED',
      'TRANSFER_REJECTED',
      transfer,
      { reason: transfer.rejectionReason || 'N/A' }
    );
    await updateRuleLastTriggered('booking_transfer.rejected');
  } catch (err) {
    console.error('[NotifTrigger] notifyTransferRejected error:', err.message);
  }
}

async function notifyTransferCompleted(app, transfer) {
  try {
    const fromUserId = transfer.fromUserId?._id || transfer.fromUserId;
    const toUserId = transfer.toUserId?._id || transfer.toUserId;
    if (!(await shouldTriggerRule('booking_transfer.completed', fromUserId, 'TRANSFER_COMPLETED'))) return;
    await sendTransferNotification(
      app,
      [fromUserId, toUserId],
      'TRANSFER_COMPLETED',
      'TRANSFER_COMPLETED',
      transfer
    );
    await updateRuleLastTriggered('booking_transfer.completed');
  } catch (err) {
    console.error('[NotifTrigger] notifyTransferCompleted error:', err.message);
  }
}

async function notifyMembershipTransferListed(app, transfer) {
  try {
    const fromUserId = String(transfer.fromUserId?._id || transfer.fromUserId);
    const users = await User.find({
      role: 'customer',
      status: true,
      _id: { $ne: fromUserId },
    })
      .select('_id')
      .lean();
    const userIds = users.map((user) => String(user._id));
    if (!userIds.length) return null;

    const entitlement = transfer.entitlementId || {};
    const result = await notificationService.createForUsersAutoNotification(
      'MEMBERSHIP_TRANSFER_LISTED',
      `membership_transfer_${transfer._id}_listed`,
      userIds,
      'MEMBERSHIP_TRANSFER_LISTED',
      {
        transferId: String(transfer._id),
        slotCode: entitlement.slotCode || 'Membership space',
        askingPrice: Number(transfer.askingPrice || 0).toLocaleString('vi-VN'),
        listingExpiresAt: transfer.listingExpiresAt,
        deepLink: `/customer/membership-transfer-marketplace/${transfer._id}`,
      }
    );
    const io = getIO(app);
    if (result?.notification && io) {
      await Promise.all(
        result.userIds.map((userId) =>
          emitNotification(io, userId, result.notification, {
            notifyAdmins: false,
            includeAudience: false,
          }).catch(() => null)
        )
      );
    }
    return result;
  } catch (err) {
    console.error('[NotifTrigger] notifyMembershipTransferListed error:', err.message);
    return null;
  }
}

async function notifyMembershipTransferClaimed(app, transferId) {
  try {
    const transfer = await MembershipEntitlementTransfer.findById(transferId)
      .populate('entitlementId', 'slotCode')
      .lean();
    if (!transfer?.fromUserId || transfer.mode !== 'PUBLIC') return null;
    const userId = String(transfer.fromUserId);
    const notification = await notificationService.createAutoNotification(
      'MEMBERSHIP_TRANSFER_CLAIMED',
      `membership_transfer_${transfer._id}_claimed_${transfer.claimAttemptCount}`,
      userId,
      'MEMBERSHIP_TRANSFER_CLAIMED',
      {
        transferId: String(transfer._id),
        slotCode: transfer.entitlementId?.slotCode || 'Membership space',
        deepLink: '/customer/membership-transfers',
      }
    );
    const io = getIO(app);
    if (notification && io) {
      await emitNotification(io, userId, notification, {
        notifyAdmins: false,
        includeAudience: false,
      });
    }
    return notification;
  } catch (err) {
    console.error('[NotifTrigger] notifyMembershipTransferClaimed error:', err.message);
    return null;
  }
}

async function notifyMembershipTransferCompleted(app, transferId) {
  try {
    const transfer = await MembershipEntitlementTransfer.findById(transferId)
      .populate('entitlementId', 'slotCode')
      .lean();
    if (!transfer || transfer.status !== 'COMPLETED') return null;
    const userIds = [transfer.fromUserId, transfer.toUserId]
      .filter(Boolean)
      .map(String);
    const io = getIO(app);
    await Promise.all(
      userIds.map(async (userId) => {
        const notification = await notificationService.createAutoNotification(
          'MEMBERSHIP_TRANSFER_COMPLETED',
          `membership_transfer_${transfer._id}_completed_${userId}`,
          userId,
          'MEMBERSHIP_TRANSFER_COMPLETED',
          {
            transferId: String(transfer._id),
            slotCode: transfer.entitlementId?.slotCode || 'Membership space',
            deepLink: '/customer/membership-transfers',
          }
        );
        if (notification && io) {
          await emitNotification(io, userId, notification, {
            notifyAdmins: false,
            includeAudience: false,
          });
        }
      })
    );
  } catch (err) {
    console.error('[NotifTrigger] notifyMembershipTransferCompleted error:', err.message);
  }
}

// ─── PARKING ────────────────────────────────────────────────────────────────────

async function sendContractNotification(app, contract, eventKey, templateKey, suffix, templateData = {}) {
  const userId = contract.userId?._id || contract.userId;
  if (!userId) return;

  if (!(await shouldTriggerRule(eventKey, userId, templateKey))) return;

  const notification = await notificationService.createAutoNotification(
    templateKey,
    `contract_${contract._id}_${suffix}`,
    userId,
    templateKey,
    {
      contractCode: contract.contractCode,
      slotCode: contract.slotCode,
      ...templateData,
    }
  );

  if (notification) {
    const io = getIO(app);
    if (io) await emitNotification(io, userId, notification);
    await updateRuleLastTriggered(eventKey);
  }
}

async function notifyContractActivated(app, contract) {
  try {
    await sendContractNotification(
      app,
      contract,
      'contract.activated',
      'CONTRACT_ACTIVATED',
      'activated'
    );
  } catch (err) {
    console.error('[NotifTrigger] notifyContractActivated error:', err.message);
  }
}

async function notifyContractCancelled(app, contract) {
  try {
    await sendContractNotification(
      app,
      contract,
      'contract.cancelled',
      'CONTRACT_CANCELLED',
      'cancelled',
      { reason: contract.cancellationReason || '' }
    );
  } catch (err) {
    console.error('[NotifTrigger] notifyContractCancelled error:', err.message);
  }
}

async function notifyContractExpired(app, contract) {
  try {
    await sendContractNotification(
      app,
      contract,
      'contract.expired',
      'CONTRACT_EXPIRED',
      'expired'
    );
  } catch (err) {
    console.error('[NotifTrigger] notifyContractExpired error:', err.message);
  }
}

async function notifyVehicleEntry(app, userId, plate, slot) {
  try {
    if (!(await shouldTriggerRule('parking.entry', userId, 'VEHICLE_ENTRY'))) return;

    const notification = await notificationService.createAutoNotification(
      'VEHICLE_ENTRY',
      `user_${userId}_entry_${Date.now()}`,
      userId,
      'VEHICLE_ENTRY',
      { plate, slot: slot || 'N/A' }
    );
    if (notification) {
      const io = getIO(app);
      if (io) await emitNotification(io, userId, notification);
      await updateRuleLastTriggered('parking.entry');
    }
  } catch (err) {
    console.error('[NotifTrigger] notifyVehicleEntry error:', err.message);
  }
}

async function notifyVehicleExit(app, userId, plate, totalCost) {
  try {
    if (!(await shouldTriggerRule('parking.exit', userId, 'VEHICLE_EXIT'))) return;

    const fmtCost = Number(totalCost).toLocaleString('vi-VN');
    const notification = await notificationService.createAutoNotification(
      'VEHICLE_EXIT',
      `user_${userId}_exit_${Date.now()}`,
      userId,
      'VEHICLE_EXIT',
      { plate, totalCost: fmtCost }
    );
    if (notification) {
      const io = getIO(app);
      if (io) await emitNotification(io, userId, notification);
      await updateRuleLastTriggered('parking.exit');
    }
  } catch (err) {
    console.error('[NotifTrigger] notifyVehicleExit error:', err.message);
  }
}

async function notifyParkingTimeWarning(app, userId, sessionId, minutesLeft) {
  try {
    let templateKey;
    let ruleKey;
    if (minutesLeft === 30) {
      templateKey = 'PARKING_30MIN_WARNING';
      ruleKey = 'parking.remaining_30';
    } else if (minutesLeft === 15) {
      templateKey = 'PARKING_15MIN_WARNING';
      ruleKey = 'parking.remaining_15';
    } else if (minutesLeft === 5) {
      templateKey = 'PARKING_5MIN_WARNING';
      ruleKey = 'parking.remaining_5';
    } else {
      return;
    }

    if (!(await shouldTriggerRule(ruleKey, userId, templateKey))) return;

    // Anti-spam: use session+minutes as referenceId so each warning only sent once
    const notification = await notificationService.createAutoNotification(
      templateKey,
      `session_${sessionId}_${minutesLeft}min`,
      userId,
      templateKey
    );
    if (notification) {
      const io = getIO(app);
      if (io) await emitNotification(io, userId, notification);
      await updateRuleLastTriggered(ruleKey);
    }
  } catch (err) {
    console.error('[NotifTrigger] notifyParkingTimeWarning error:', err.message);
  }
}

async function notifyParkingExpired(app, userId, sessionId) {
  try {
    if (!(await shouldTriggerRule('parking.expired', userId, 'PARKING_EXPIRED'))) return;

    const notification = await notificationService.createAutoNotification(
      'PARKING_EXPIRED',
      `session_${sessionId}_expired`,
      userId,
      'PARKING_EXPIRED'
    );
    if (notification) {
      const io = getIO(app);
      if (io) await emitNotification(io, userId, notification);
      queueNotificationEmail(userId, 'parking.expired');
      await updateRuleLastTriggered('parking.expired');
    }
  } catch (err) {
    console.error('[NotifTrigger] notifyParkingExpired error:', err.message);
  }
}

async function notifyParkingOvertime(app, userId, sessionId) {
  try {
    if (!(await shouldTriggerRule('parking.expired', userId, 'PARKING_OVERTIME'))) return;

    const notification = await notificationService.createAutoNotification(
      'PARKING_OVERTIME',
      `session_${sessionId}_overtime`,
      userId,
      'PARKING_OVERTIME'
    );
    if (notification) {
      const io = getIO(app);
      if (io) await emitNotification(io, userId, notification);
    }
  } catch (err) {
    console.error('[NotifTrigger] notifyParkingOvertime error:', err.message);
  }
}

// ─── CAMERA ─────────────────────────────────────────────────────────────────────

async function notifyPlateRecognized(app, userId, plate) {
  try {
    const notification = await notificationService.createAutoNotification(
      'PLATE_RECOGNIZED',
      `user_${userId}_plate_${Date.now()}`,
      userId,
      'PLATE_RECOGNIZED',
      { plate }
    );
    if (notification) {
      const io = getIO(app);
      if (io) await emitNotification(io, userId, notification);
    }
  } catch (err) {
    console.error('[NotifTrigger] notifyPlateRecognized error:', err.message);
  }
}

async function notifyPlateMismatch(app, userId, expected, detected) {
  try {
    const notification = await notificationService.createAutoNotification(
      'PLATE_MISMATCH',
      `user_${userId}_mismatch_${Date.now()}`,
      userId,
      'PLATE_MISMATCH',
      { expected, detected }
    );
    if (notification) {
      const io = getIO(app);
      if (io) await emitNotification(io, userId, notification);
    }
  } catch (err) {
    console.error('[NotifTrigger] notifyPlateMismatch error:', err.message);
  }
}

// ─── SYSTEM ─────────────────────────────────────────────────────────────────────

async function notifySystemMaintenance(app) {
  try {
    if (!(await shouldTriggerRule('system.maintenance'))) return;

    const result = await notificationService.createBroadcastAutoNotification(
      'SYSTEM_MAINTENANCE',
      `system_maintenance_${Date.now()}`,
      'SYSTEM_MAINTENANCE'
    );
    if (result) {
      const io = getIO(app);
      if (io) broadcastNotification(io, result.notification, result.userIds);
      queueBroadcastEmail(result.userIds, 'system.maintenance');
      await updateRuleLastTriggered('system.maintenance');
    }
  } catch (err) {
    console.error('[NotifTrigger] notifySystemMaintenance error:', err.message);
  }
}

async function notifyVersionUpdate(app) {
  try {
    if (!(await shouldTriggerRule('system.update'))) return;

    const result = await notificationService.createBroadcastAutoNotification(
      'SYSTEM_UPDATE',
      `system_update_${Date.now()}`,
      'SYSTEM_UPDATE'
    );
    if (result) {
      const io = getIO(app);
      if (io) broadcastNotification(io, result.notification, result.userIds);
      queueBroadcastEmail(result.userIds, 'system.update');
      await updateRuleLastTriggered('system.update');
    }
  } catch (err) {
    console.error('[NotifTrigger] notifyVersionUpdate error:', err.message);
  }
}

module.exports = {
  // Helpers
  isRuleEnabled,
  shouldTriggerRule,
  // Account
  notifyRegistrationSuccess,
  notifyEmailVerified,
  notifyPasswordChanged,
  notifyAccountLocked,
  notifyAccountUnlocked,
  // Wallet
  notifyTopUpSuccess,
  notifyTopUpFailed,
  notifyRefundSuccess,
  notifyLowBalance,
  // Payment
  notifyPaymentSuccess,
  notifyPaymentFailed,
  // Violation
  notifyViolationCreated,
  notifyViolationPaymentReminder,
  notifyViolationPaid,
  notifyViolationCancelled,
  // Booking
  notifyBookingSuccess,
  notifyBookingCancelled,
  notifyBookingCheckinReminder,
  notifyBookingCheckinExpired,
  notifyBookingEndingSoon,
  notifyBookingTimeExpired,
  notifyBookingNoShowCancelled,
  notifyVipExpiringSoon,
  notifyVipExpired,
  notifyTransferRequestCreated,
  notifyTransferApproved,
  notifyTransferRejected,
  notifyTransferCompleted,
  notifyMembershipTransferListed,
  notifyMembershipTransferClaimed,
  notifyMembershipTransferCompleted,
  notifyContractActivated,
  notifyContractCancelled,
  notifyContractExpired,
  // Parking
  notifyVehicleEntry,
  notifyVehicleExit,
  notifyParkingTimeWarning,
  notifyParkingExpired,
  notifyParkingOvertime,
  // Camera
  notifyPlateRecognized,
  notifyPlateMismatch,
  // System
  notifySystemMaintenance,
  notifyVersionUpdate,
};
