import { useCallback, useState } from 'react';

export function useNotificationDetails(markAsRead) {
  const [selectedNotification, setSelectedNotification] = useState(null);
  const openNotification = useCallback((notification) => {
    setSelectedNotification(notification);
    if (!notification.isRead) markAsRead(notification.notificationId || notification._id);
  }, [markAsRead]);
  const closeNotification = useCallback(() => setSelectedNotification(null), []);
  return { selectedNotification, openNotification, closeNotification };
}
