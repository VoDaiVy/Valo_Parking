const jwt = require('jsonwebtoken');
const notificationService = require('../services/notificationService');

// Map of userId -> Set of socket IDs
const onlineUsers = new Map();

/**
 * Setup Socket.IO notification handlers
 * @param {import('socket.io').Server} io
 */
function setupNotificationSocket(io) {
  // Auth middleware — verify JWT before allowing connection
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) {
      return next(new Error('Authentication required'));
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.userId = decoded.id;
      socket.userRole = decoded.role;
      next();
    } catch (err) {
      return next(new Error('Invalid token'));
    }
  });

  io.on('connection', async (socket) => {
    const userId = socket.userId;
    console.log(`🔌 Socket connected: ${userId} (${socket.id})`);

    // Track online user
    if (!onlineUsers.has(userId)) {
      onlineUsers.set(userId, new Set());
    }
    onlineUsers.get(userId).add(socket.id);

    // Send initial unread count
    try {
      const unreadCount = await notificationService.getUnreadCount(userId, socket.userRole);
      socket.emit('notification:unreadCount', { count: unreadCount });
    } catch (err) {
      console.error('Error fetching unread count on connect:', err.message);
    }

    // ── Handle: mark single notification as read ──
    socket.on('notification:read', async (data, callback) => {
      try {
        const { notificationId } = data;
        await notificationService.markAsRead(userId, notificationId);
        await emitUnreadCountsToUser(io, userId);

        if (typeof callback === 'function') {
          callback({ success: true });
        }
      } catch (err) {
        console.error('Error marking notification read:', err.message);
        if (typeof callback === 'function') {
          callback({ success: false, error: err.message });
        }
      }
    });

    // ── Handle: mark all as read ──
    socket.on('notification:readAll', async (data, callback) => {
      try {
        await notificationService.markAllAsRead(userId);

        await emitUnreadCountsToUser(io, userId);

        if (typeof callback === 'function') {
          callback({ success: true });
        }
      } catch (err) {
        console.error('Error marking all read:', err.message);
        if (typeof callback === 'function') {
          callback({ success: false, error: err.message });
        }
      }
    });

    // ── Handle: delete notification ──
    socket.on('notification:delete', async (data, callback) => {
      try {
        const { notificationId } = data;
        await notificationService.deleteNotification(userId, notificationId);
        await emitUnreadCountsToUser(io, userId);

        if (typeof callback === 'function') {
          callback({ success: true });
        }
      } catch (err) {
        console.error('Error deleting notification:', err.message);
        if (typeof callback === 'function') {
          callback({ success: false, error: err.message });
        }
      }
    });

    // ── Handle disconnect ──
    socket.on('disconnect', () => {
      console.log(`🔌 Socket disconnected: ${userId} (${socket.id})`);
      const userSockets = onlineUsers.get(userId);
      if (userSockets) {
        userSockets.delete(socket.id);
        if (userSockets.size === 0) {
          onlineUsers.delete(userId);
        }
      }
    });
  });

  return { onlineUsers };
}

/**
 * Emit an event to all sockets of a specific user
 */
function emitToUser(io, userId, event, data) {
  const userSockets = onlineUsers.get(String(userId));
  if (userSockets) {
    for (const socketId of userSockets) {
      io.to(socketId).emit(event, data);
    }
  }
}

/**
 * Recalculate unread counts using each socket's authenticated role.
 */
async function emitUnreadCountsToUser(io, userId) {
  const userSockets = onlineUsers.get(String(userId));
  if (!userSockets) return;

  const countsByRole = new Map();
  for (const socketId of userSockets) {
    const socket = io.sockets.sockets.get(socketId);
    if (!socket) continue;

    const role = socket.userRole;
    if (!countsByRole.has(role)) {
      countsByRole.set(
        role,
        await notificationService.getUnreadCount(userId, role)
      );
    }
    socket.emit('notification:unreadCount', {
      count: countsByRole.get(role),
    });
  }
}

/**
 * Emit an event to all connected admin/staff sockets.
 */
function emitToAdmins(io, event, data) {
  for (const socket of io.sockets.sockets.values()) {
    if (['admin', 'staff'].includes(socket.userRole)) {
      socket.emit(event, data);
    }
  }
}

/**
 * Emit a new notification to a user (with unread count update)
 */
async function emitNotification(
  io,
  userId,
  notification,
  {
    notifyAdmins = true,
    updateUnreadCount = true,
    includeAudience = true,
  } = {}
) {
  const payload = {
    _id: notification._id,
    title: notification.title,
    content: notification.content,
    type: notification.type,
    priority: notification.priority,
    metadata: notification.metadata,
    createdAt: notification.createdAt,
    ...(includeAudience
      ? {
          targetType: notification.targetType,
          targetRoles: notification.targetRoles,
          targetUsers: notification.targetUsers,
          recipientCount: notification.recipientCount,
        }
      : {}),
  };

  emitToUser(io, userId, 'notification:new', payload);
  if (notifyAdmins) {
    emitToAdmins(io, 'notification:admin:new', payload);
  }

  // Also update unread count
  if (updateUnreadCount) {
    try {
      await emitUnreadCountsToUser(io, userId);
    } catch (err) {
      console.error('Error emitting unread count:', err.message);
    }
  }
}

/**
 * Broadcast a notification event to all online users
 */
function broadcastNotification(io, notification, userIds = []) {
  const payload = {
    _id: notification._id,
    title: notification.title,
    content: notification.content,
    type: notification.type,
    priority: notification.priority,
    metadata: notification.metadata,
    createdAt: notification.createdAt,
    targetType: notification.targetType,
    targetRoles: notification.targetRoles,
    targetUsers: notification.targetUsers,
    recipientCount: notification.recipientCount,
  };

  for (const userId of new Set(userIds.map(String))) {
    emitToUser(io, userId, 'notification:new', payload);
  }
  emitToAdmins(io, 'notification:admin:new', payload);
}

module.exports = {
  setupNotificationSocket,
  emitToUser,
  emitUnreadCountsToUser,
  emitToAdmins,
  emitNotification,
  broadcastNotification,
  onlineUsers,
};
