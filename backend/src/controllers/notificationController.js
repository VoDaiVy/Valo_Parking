const { validationResult } = require('express-validator');
const notificationService = require('../services/notificationService');
const { sendSingleUserNotification } = require('../services/notificationDispatchService');
const { emitNotification, broadcastNotification } = require('../sockets/notificationSocket');
const NotificationRule = require('../models/NotificationRule');

/**
 * @desc    Create and send a notification (Admin/Staff)
 * @route   POST /api/notifications
 * @access  Private (admin, staff)
 */
const createNotification = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array(),
      });
    }

    const {
      title,
      content,
      type,
      priority,
      targetType,
      targetUsers,
      targetRoles,
    } = req.body;
    const createdBy = req.user._id;
    const io = req.app.get('io');

    let result;

    if (targetType === 'ALL_USERS') {
      result = await notificationService.createForAllUsers(
        { title, content, type, priority },
        createdBy
      );
      if (io) {
        broadcastNotification(io, result.notification, result.userIds);
      }

      return res.status(201).json({
        success: true,
        message: `Notification sent to ${result.userIds.length} users`,
        data: result.notification,
      });
    }

    if (targetType === 'SINGLE_USER') {
      if (!targetUsers || targetUsers.length !== 1) {
        return res.status(400).json({
          success: false,
          message: 'targetUsers must contain exactly 1 user ID for SINGLE_USER',
        });
      }

      const { notification } = await sendSingleUserNotification({
        io,
        targetUserId: targetUsers[0],
        title,
        content,
        type,
        priority,
        createdBy,
      });

      return res.status(201).json({
        success: true,
        message: 'Notification sent successfully',
        data: notification,
      });
    }

    if (targetType === 'MULTI_USER') {
      if (!targetUsers || targetUsers.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'targetUsers must contain at least 1 user ID for MULTI_USER',
        });
      }

      const notification = await notificationService.createForUsers(
        targetUsers,
        { title, content, type, priority },
        createdBy,
        { requireActive: true }
      );

      if (io) {
        for (let index = 0; index < notification.targetUsers.length; index += 1) {
          await emitNotification(io, notification.targetUsers[index], notification, {
            notifyAdmins: index === 0,
            updateUnreadCount: false,
          });
        }
      }

      return res.status(201).json({
        success: true,
        message: `Notification sent to ${notification.recipientCount} users`,
        data: notification,
      });
    }

    if (targetType === 'ROLE_BASED') {
      const result = await notificationService.createForRole(
        targetRoles,
        { title, content, type, priority },
        createdBy
      );

      if (io) {
        for (let index = 0; index < result.userIds.length; index += 1) {
          await emitNotification(io, result.userIds[index], result.notification, {
            notifyAdmins: index === 0,
            updateUnreadCount: false,
          });
        }
      }

      return res.status(201).json({
        success: true,
        message: `Notification sent to ${result.userIds.length} users in role(s): ${targetRoles.join(', ')}`,
        data: result.notification,
      });
    }

    return res.status(400).json({
      success: false,
      message: 'Invalid targetType',
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get current user's notifications (paginated, filtered)
 * @route   GET /api/notifications
 * @access  Private
 */
const getUserNotifications = async (req, res, next) => {
  try {
    const { page, limit, type, isRead, search } = req.query;
    const result = await notificationService.getUserNotifications(req.user._id, {
      page,
      limit,
      type,
      isRead,
      search,
      contextRole: req.user.role,
    });

    res.status(200).json({
      success: true,
      data: result.notifications,
      pagination: result.pagination,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get unread notification count
 * @route   GET /api/notifications/unread-count
 * @access  Private
 */
const getUnreadCount = async (req, res, next) => {
  try {
    const count = await notificationService.getUnreadCount(req.user._id, req.user.role);
    res.status(200).json({
      success: true,
      data: { count },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Create an internal report (Staff to Admin)
 * @route   POST /api/notifications/internal-report
 * @access  Private (staff)
 */
const createInternalReport = async (req, res, next) => {
  try {
    const { content, priority = 'INFO' } = req.body;
    
    if (!content) {
      return res.status(400).json({ success: false, message: 'Content is required' });
    }

    const title = `Issue Report from ${req.user.name || 'Staff'}`;
    const createdBy = req.user._id;
    const io = req.app.get('io');

    const result = await notificationService.createForRole(
      'admin',
      { title, content, type: 'SYSTEM', priority, targetType: 'ROLE_BASED', targetRoles: ['admin'] },
      createdBy
    );

    if (io) {
      // emitNotification or broadcast to admins
      // Since createForRole will resolve users with role 'admin'
      const { notification, userIds } = result;
      for (let index = 0; index < userIds.length; index += 1) {
        await emitNotification(io, userIds[index], notification, {
          notifyAdmins: index === 0,
          updateUnreadCount: false,
        });
      }
    }

    res.status(201).json({
      success: true,
      message: 'Report sent successfully',
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Mark a notification as read
 * @route   PUT /api/notifications/:id/read
 * @access  Private
 */
const markAsRead = async (req, res, next) => {
  try {
    const result = await notificationService.markAsRead(req.user._id, req.params.id);
    if (!result) {
      return res.status(404).json({
        success: false,
        message: 'Notification not found',
      });
    }

    res.status(200).json({
      success: true,
      message: 'Notification marked as read',
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Mark all notifications as read
 * @route   PUT /api/notifications/read-all
 * @access  Private
 */
const markAllAsRead = async (req, res, next) => {
  try {
    const result = await notificationService.markAllAsRead(req.user._id);
    res.status(200).json({
      success: true,
      message: `${result.modifiedCount} notifications marked as read`,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Soft delete a notification
 * @route   DELETE /api/notifications/:id
 * @access  Private
 */
const deleteUserNotification = async (req, res, next) => {
  try {
    const result = await notificationService.deleteNotification(req.user._id, req.params.id);
    if (!result) {
      return res.status(404).json({
        success: false,
        message: 'Notification not found',
      });
    }

    res.status(200).json({
      success: true,
      message: 'Notification deleted',
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get admin notification history
 * @route   GET /api/notifications/admin/history
 * @access  Private (admin, staff)
 */
const getAdminHistory = async (req, res, next) => {
  try {
    const { page, limit, type, priority, search } = req.query;
    const result = await notificationService.getAdminNotifications({
      page,
      limit,
      type,
      priority,
      search,
      adminId: req.user._id,
    });

    res.status(200).json({
      success: true,
      data: result.notifications,
      pagination: result.pagination,
      stats: result.stats,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Mark an admin history notification as read for current admin/staff
 * @route   PUT /api/notifications/admin/history/:id/read
 * @access  Private (admin, staff)
 */
const markAdminHistoryAsRead = async (req, res, next) => {
  try {
    const notification = await notificationService.markAdminNotificationAsRead(
      req.user._id,
      req.params.id
    );

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: 'Notification not found',
      });
    }

    res.status(200).json({
      success: true,
      message: 'Notification marked as read',
      data: notification,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Mark all admin history notifications as read for current admin/staff
 * @route   PUT /api/notifications/admin/history/read-all
 * @access  Private (admin, staff)
 */
const markAllAdminHistoryAsRead = async (req, res, next) => {
  try {
    const result = await notificationService.markAllAdminNotificationsAsRead(req.user._id);

    res.status(200).json({
      success: true,
      message: `${result.modifiedCount} notifications marked as read`,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Hide an admin history notification for current admin/staff
 * @route   DELETE /api/notifications/admin/history/:id
 * @access  Private (admin, staff)
 */
const deleteAdminHistoryNotification = async (req, res, next) => {
  try {
    const notification = await notificationService.deleteAdminNotification(
      req.user._id,
      req.params.id
    );

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: 'Notification not found',
      });
    }

    res.status(200).json({
      success: true,
      message: 'Notification deleted',
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Revoke a notification (admin only)
 * @route   PUT /api/notifications/:id/revoke
 * @access  Private (admin, staff)
 */
const revokeNotification = async (req, res, next) => {
  try {
    const notification = await notificationService.revokeNotification(req.params.id);
    if (!notification) {
      return res.status(404).json({
        success: false,
        message: 'Notification not found',
      });
    }

    res.status(200).json({
      success: true,
      message: 'Notification revoked',
      data: notification,
    });
  } catch (error) {
    next(error);
  }
};

// ─── AUTO RULES CRUD ────────────────────────────────────────────────────────────

/**
 * @desc    Get all auto notification rules
 * @route   GET /api/notifications/admin/rules
 * @access  Private (admin, staff)
 */
const getAutoRules = async (req, res, next) => {
  try {
    const rules = await NotificationRule.find().sort({ group: 1, eventKey: 1 }).lean();

    res.status(200).json({
      success: true,
      data: rules,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Update an auto notification rule
 * @route   PUT /api/notifications/admin/rules/:eventKey
 * @access  Private (admin, staff)
 */
const updateAutoRule = async (req, res, next) => {
  try {
    const { eventKey } = req.params;
    const { enabled, channels, throttleMinutes } = req.body;

    const updateData = {};
    if (enabled !== undefined) updateData.enabled = enabled;
    if (channels !== undefined) updateData.channels = channels;
    if (throttleMinutes !== undefined) updateData.throttleMinutes = throttleMinutes;

    const rule = await NotificationRule.findOneAndUpdate(
      { eventKey },
      updateData,
      { new: true }
    );

    if (!rule) {
      return res.status(404).json({
        success: false,
        message: `Auto rule '${eventKey}' not found`,
      });
    }

    res.status(200).json({
      success: true,
      message: 'Auto rule updated',
      data: rule,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Test trigger an auto notification rule (sends a test notification to the admin)
 * @route   POST /api/notifications/admin/rules/:eventKey/test
 * @access  Private (admin, staff)
 */
const testAutoRule = async (req, res, next) => {
  try {
    const { eventKey } = req.params;
    const rule = await NotificationRule.findOne({ eventKey });

    if (!rule) {
      return res.status(404).json({
        success: false,
        message: `Auto rule '${eventKey}' not found`,
      });
    }

    // Create a test notification for the requesting admin
    const userId = req.user._id;
    const notification = await notificationService.createForUser(
      userId,
      {
        title: `[TEST] ${rule.name}`,
        content: `Test trigger cho rule "${rule.name}" (${rule.eventKey}). Channels: ${rule.channels.join(', ')}.`,
        type: 'SYSTEM',
        priority: rule.priority,
        metadata: { eventType: rule.eventKey, isTest: true },
      }
    );

    // Emit via socket if online
    const io = req.app.get('io');
    if (io) {
      await emitNotification(io, userId, notification);
    }

    // Update lastTriggeredAt
    await NotificationRule.findOneAndUpdate(
      { eventKey },
      { lastTriggeredAt: new Date() }
    );

    res.status(200).json({
      success: true,
      message: `Test notification sent for rule '${rule.name}'`,
      data: notification,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createNotification,
  getUserNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  deleteUserNotification,
  getAdminHistory,
  markAdminHistoryAsRead,
  markAllAdminHistoryAsRead,
  deleteAdminHistoryNotification,
  revokeNotification,
  getAutoRules,
  updateAutoRule,
  testAutoRule,
  createInternalReport,
};
