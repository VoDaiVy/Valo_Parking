import { notificationFromSocket } from '../utils/notificationSocketPayload';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useSocket } from './useSocket';
import * as notifApi from '../services/notificationService';

const NOTIFICATIONS_CHANGED_EVENT = 'valo_notifications_changed';

function getNotificationId(notification) {
  return String(notification.notificationId || notification._id);
}

function requireSuccessfulResponse(response, fallbackMessage) {
  if (!response?.ok) {
    throw new Error(response?.data?.message || fallbackMessage);
  }
  return response;
}

function broadcastNotificationsChanged() {
  window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED_EVENT));
}

/**
 * useNotifications — custom hook for notification state management.
 *
 * Returns:
 *  - notifications, unreadCount, loading, error, hasMore
 *  - fetchMore(), markAsRead(id), markAllAsRead(), deleteNotification(id), refresh()
 *
 * Listens to socket 'notification:new' and 'notification:unreadCount' events.
 */
export function useNotifications({ autoFetch = true, limit = 20, contextRole } = {}) {
  const socket = useSocket();
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [filters, setFilters] = useState({ type: null, isRead: null, search: '' });
  const isMounted = useRef(true);
  const receivedIds = useRef(new Set());
  const notificationsRef = useRef([]);
  const pendingReadIds = useRef(new Set());
  const pendingDeleteIds = useRef(new Set());
  const markingAllRef = useRef(false);

  // ── Fetch unread count ──
  const fetchUnreadCount = useCallback(async () => {
    try {
      const token = localStorage.getItem('accessToken');
      if (!token) return;

      const res = await notifApi.getUnreadCount({ contextRole });
      if (res.ok && isMounted.current) {
        setUnreadCount(res.data?.data?.count ?? 0);
      }
    } catch {
      // Silent fail
    }
  }, [contextRole]);

  // ── Fetch notifications ──
  const fetchNotifications = useCallback(async (pageNum = 1, replace = true) => {
    try {
      const token = localStorage.getItem('accessToken');
      if (!token) return;

      if (isMounted.current) setLoading(true);

      const params = { page: pageNum, limit };
      if (contextRole) params.contextRole = contextRole;
      if (filters.type) params.type = filters.type;
      if (filters.isRead !== null && filters.isRead !== undefined && filters.isRead !== '')
        params.isRead = filters.isRead;
      if (filters.search) params.search = filters.search;

      const res = await notifApi.getNotifications(params);
      requireSuccessfulResponse(res, 'Unable to load notifications');

      if (isMounted.current) {
        const newNotifs = res.data?.data || [];
        const pagination = res.data?.pagination || {};
        newNotifs.forEach((item) => {
          receivedIds.current.add(String(item.notificationId || item._id));
        });

        if (replace) {
          notificationsRef.current = newNotifs;
          setNotifications(newNotifs);
        } else {
          setNotifications((prev) => {
            const existingIds = new Set(prev.map(getNotificationId));
            const next = [
              ...prev,
              ...newNotifs.filter((item) => !existingIds.has(getNotificationId(item))),
            ];
            notificationsRef.current = next;
            return next;
          });
        }

        setPage(pageNum);
        setHasMore(pageNum < (pagination.totalPages || 1));
        setError(null);
      }
    } catch (err) {
      if (isMounted.current) setError(err.message);
    } finally {
      if (isMounted.current) setLoading(false);
    }
  }, [contextRole, filters, limit]);

  // ── Initial fetch ──
  useEffect(() => {
    isMounted.current = true;
    let timerId;
    if (autoFetch) {
      timerId = window.setTimeout(() => {
        fetchNotifications(1, true);
        fetchUnreadCount();
      }, 0);
    }
    return () => {
      if (timerId) window.clearTimeout(timerId);
      isMounted.current = false;
    };
  }, [autoFetch, fetchNotifications, fetchUnreadCount]);

  // ── Socket listeners ──
  useEffect(() => {
    if (!socket) return;

    const handleNew = (notification) => {
      if (
        notification.targetType === 'ROLE_BASED' &&
        contextRole &&
        !notification.targetRoles?.includes(contextRole)
      ) {
        return;
      }

      const notificationId = String(notification._id);
      if (receivedIds.current.has(notificationId)) return;
      receivedIds.current.add(notificationId);
      setUnreadCount((count) => count + 1);

      const matchesType = !filters.type || notification.type === filters.type;
      const matchesRead = filters.isRead !== true && filters.isRead !== 'true';
      const searchValue = filters.search.trim().toLowerCase();
      const matchesSearch =
        !searchValue ||
        notification.title?.toLowerCase().includes(searchValue) ||
        notification.content?.toLowerCase().includes(searchValue);

      if (matchesType && matchesRead && matchesSearch) {
        setNotifications((prev) => {
          const next = [notificationFromSocket(notification), ...prev];
          notificationsRef.current = next;
          return next;
        });
      }
    };

    const handleUnreadCount = (data) => {
      setUnreadCount(data.count ?? 0);
    };

    const reconcileInbox = () => {
      fetchNotifications(1, true);
      fetchUnreadCount();
    };
    socket.on('connect', reconcileInbox);
    if (socket.connected) reconcileInbox();
    socket.on('notification:new', handleNew);
    socket.on('notification:unreadCount', handleUnreadCount);

    return () => {
      socket.off('connect', reconcileInbox);
      socket.off('notification:new', handleNew);
      socket.off('notification:unreadCount', handleUnreadCount);
    };
  }, [contextRole, filters, socket, fetchNotifications, fetchUnreadCount]);

  useEffect(() => {
    const handleNotificationsChanged = () => {
      fetchNotifications(1, true);
      fetchUnreadCount();
    };
    window.addEventListener(NOTIFICATIONS_CHANGED_EVENT, handleNotificationsChanged);
    return () =>
      window.removeEventListener(
        NOTIFICATIONS_CHANGED_EVENT,
        handleNotificationsChanged
      );
  }, [fetchNotifications, fetchUnreadCount]);

  // ── Actions ──
  const fetchMore = useCallback(() => {
    if (!loading && hasMore) {
      fetchNotifications(page + 1, false);
    }
  }, [loading, hasMore, page, fetchNotifications]);

  const markAsRead = useCallback(async (notificationId) => {
    const id = String(notificationId);
    const current = notifications.find((item) => getNotificationId(item) === id);
    if (!current || current.isRead || pendingReadIds.current.has(id)) return false;
    pendingReadIds.current.add(id);

    const applyReadState = () => {
      setNotifications((prev) => prev.map((n) =>
        getNotificationId(n) === id
          ? { ...n, isRead: true, readAt: new Date().toISOString() }
          : n
      ));
      setUnreadCount((count) => Math.max(0, count - 1));
    };

    try {
      // Preserve the existing optimistic behavior outside Customer.
      if (contextRole !== 'customer') applyReadState();
      const response = await notifApi.markAsRead(notificationId);
      requireSuccessfulResponse(response, 'Unable to mark notification as read');
      if (contextRole === 'customer' && isMounted.current) applyReadState();
      broadcastNotificationsChanged();
      return true;
    } catch {
      // Non-Customer optimistic updates need a refresh on failure. — re-fetch
      if (contextRole !== 'customer') { fetchNotifications(1, true); fetchUnreadCount(); }
      return false;
    } finally {
      pendingReadIds.current.delete(id);
    }
  }, [contextRole, notifications, fetchNotifications, fetchUnreadCount]);

  const markAllAsRead = useCallback(async () => {
    if (markingAllRef.current || unreadCount === 0) return false;
    markingAllRef.current = true;

    try {
      // Optimistic update
      setNotifications((prev) =>
        prev.map((n) => ({ ...n, isRead: true, readAt: new Date().toISOString() }))
      );
      setUnreadCount(0);

      const response = await notifApi.markAllAsRead();
      requireSuccessfulResponse(response, 'Unable to mark all notifications as read');
      broadcastNotificationsChanged();
      return true;
    } catch {
      fetchNotifications(1, true);
      fetchUnreadCount();
      return false;
    } finally {
      markingAllRef.current = false;
    }
  }, [fetchNotifications, fetchUnreadCount, unreadCount]);

  const deleteNotification = useCallback(async (notificationId) => {
    const id = String(notificationId);
    if (pendingDeleteIds.current.has(id)) return false;
    pendingDeleteIds.current.add(id);

    try {
      // Optimistic update
      setNotifications((prev) =>
        prev.filter(
          (n) => String(n.notificationId || n._id) !== String(notificationId)
        )
      );

      const was = notifications.find(
        (n) => String(n.notificationId || n._id) === String(notificationId)
      );
      if (was && !was.isRead) {
        setUnreadCount((c) => Math.max(0, c - 1));
      }

      const response = await notifApi.deleteNotification(notificationId);
      requireSuccessfulResponse(response, 'Unable to delete notification');
      broadcastNotificationsChanged();
      return true;
    } catch {
      fetchNotifications(1, true);
      fetchUnreadCount();
      return false;
    } finally {
      pendingDeleteIds.current.delete(id);
    }
  }, [notifications, fetchNotifications, fetchUnreadCount]);

  const refresh = useCallback(() => {
    fetchNotifications(1, true);
    fetchUnreadCount();
  }, [fetchNotifications, fetchUnreadCount]);

  const updateFilters = useCallback((newFilters) => {
    setFilters((prev) => ({ ...prev, ...newFilters }));
    setPage(1);
    setHasMore(true);
  }, []);

  return {
    notifications,
    unreadCount,
    loading,
    error,
    hasMore,
    filters,
    fetchMore,
    markAsRead,
    markAllAsRead,
    deleteNotification,
    refresh,
    updateFilters,
  };
}
