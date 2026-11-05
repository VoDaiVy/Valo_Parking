// Socket documents and flattened inbox rows retain the same presentation enum.
export function notificationFromSocket(notification, now = Date.now()) {
  return {
    _id: `temp_${now}`,
    notificationId: notification._id,
    title: notification.title,
    content: notification.content,
    type: notification.type,
    priority: notification.priority,
    metadata: notification.metadata,
    isRead: false,
    readAt: null,
    createdAt: notification.createdAt || new Date(now).toISOString(),
  };
}
