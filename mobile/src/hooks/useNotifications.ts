import { useCallback, useEffect, useMemo, useState } from 'react';

import { useSocket } from '@/hooks/useSocket';
import { useAuth } from '@/hooks/useAuth';
import { notificationsService } from '@/services/api/notifications';
import type { UserNotification } from '@/types/models';
import {
  getNotificationId,
  matchesNotificationFilter,
  type NotificationFilter,
} from '@/utils/notifications';

export const useNotifications = (filter: NotificationFilter) => {
  const socket = useSocket();
  const { user } = useAuth();
  const contextRole = user?.role === 'admin' ? 'admin' : user?.role === 'staff' ? 'staff' : 'customer';
  const [notifications, setNotifications] = useState<UserNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const query = useMemo(() => {
    if (filter === 'UNREAD') return { isRead: false };
    if (filter === 'READ') return { isRead: true };
    if (filter === 'ALL') return {};
    return { type: filter };
  }, [filter]);

  const fetchUnreadCount = useCallback(async () => {
    const response = await notificationsService.getUnreadCount(contextRole);
    setUnreadCount(response.data?.count || 0);
  }, [contextRole]);

  const fetchNotifications = useCallback(
    async (nextPage = 1, append = false) => {
      setError('');
      if (!append) setLoading(true);
      try {
        const response = await notificationsService.getNotifications({ page: nextPage, contextRole, ...query });
        const data = response.data || [];
        setNotifications((current) => (append ? [...current, ...data] : data));
        setPage(nextPage);
        setHasMore(Boolean(response.pagination && nextPage < (response.pagination.totalPages || 1)));
      } catch (fetchError) {
        setError(fetchError instanceof Error ? fetchError.message : 'Unable to load notifications.');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [query, contextRole],
  );

  const refetch = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([fetchNotifications(1), fetchUnreadCount()]);
  }, [fetchNotifications, fetchUnreadCount]);

  const loadMore = useCallback(() => {
    if (!loading && hasMore) void fetchNotifications(page + 1, true);
  }, [fetchNotifications, hasMore, loading, page]);

  const markAsRead = useCallback(async (id: string) => {
    const item = notifications.find((notification) => getNotificationId(notification) === id);
    if (!item || item.isRead) return;
    setNotifications((current) =>
      current.map((notification) => (getNotificationId(notification) === id ? { ...notification, isRead: true } : notification)),
    );
    setUnreadCount((count) => Math.max(0, count - 1));
    try {
      await notificationsService.markAsRead(id);
    } catch {
      setNotifications((current) =>
        current.map((notification) => (getNotificationId(notification) === id ? { ...notification, isRead: false } : notification)),
      );
      setUnreadCount((count) => count + 1);
    }
  }, [notifications]);

  const markAllAsRead = useCallback(async () => {
    const previous = notifications;
    setNotifications((current) => current.map((notification) => ({ ...notification, isRead: true })));
    setUnreadCount(0);
    try {
      await notificationsService.markAllAsRead();
    } catch {
      setNotifications(previous);
      void fetchUnreadCount();
    }
  }, [fetchUnreadCount, notifications]);

  const deleteNotification = useCallback(async (id: string) => {
    const previous = notifications;
    const deleted = previous.find((notification) => getNotificationId(notification) === id);
    setNotifications((current) => current.filter((notification) => getNotificationId(notification) !== id));
    if (deleted && !deleted.isRead) setUnreadCount((count) => Math.max(0, count - 1));
    try {
      await notificationsService.deleteNotification(id);
    } catch {
      setNotifications(previous);
      void fetchUnreadCount();
    }
  }, [fetchUnreadCount, notifications]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  useEffect(() => {
    const handler = (payload: unknown) => {
      const incoming = payload as UserNotification;
      if (!incoming?.title || !incoming?.content) return;
      setUnreadCount((count) => count + 1);
      if (matchesNotificationFilter(incoming, filter)) {
        setNotifications((current) => [incoming, ...current]);
      }
    };
    socket.on('notification:new', handler);
    return () => socket.off('notification:new', handler);
  }, [filter, socket]);

  return {
    notifications,
    unreadCount,
    loading,
    refreshing,
    error,
    hasMore,
    refetch,
    loadMore,
    markAsRead,
    markAllAsRead,
    deleteNotification,
  };
};

