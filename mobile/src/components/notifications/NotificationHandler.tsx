import { useEffect, useRef, useState } from 'react';
import type { NotificationResponse } from 'expo-notifications';
import { Platform } from 'react-native';

import { useExpoPushToken } from '@/hooks/useExpoPushToken';
import { useNotificationPermissions } from '@/hooks/useNotificationPermissions';
import { useSocket } from '@/hooks/useSocket';
import { useAuth } from '@/hooks/useAuth';
import { openNotification, clearPendingNotification } from '@/navigation/notificationNavigation';
import type { UserNotification } from '@/types/models';
import { isExpoGo } from '@/utils/notificationRuntime';

import { InAppNotificationBanner } from './InAppNotificationBanner';

export const NotificationHandler = () => {
  const socket = useSocket();
  const { user, isAuthenticated } = useAuth();
  const permissions = useNotificationPermissions();
  useExpoPushToken(isAuthenticated && permissions.status === 'granted');
  const [banner, setBanner] = useState<UserNotification | null>(null);
  const handledResponse = useRef('');
  useEffect(() => {
    if (!isAuthenticated) {
      clearPendingNotification();
      setBanner(null);
      handledResponse.current = '';
    }
  }, [isAuthenticated]);

  useEffect(() => {
    if (isAuthenticated && permissions.status === 'undetermined' && !permissions.loading) {
      void permissions.requestPermission();
    }
  }, [permissions]);

  useEffect(() => {
    if (isExpoGo || Platform.OS === 'web' || !isAuthenticated || !user?.role) return undefined;

    let active = true;
    let subscription: { remove: () => void } | undefined;
    let responseSubscription: { remove: () => void } | undefined;
    void import('expo-notifications').then((Notifications) => {
      if (!active) return;
      Notifications.setNotificationHandler({
        handleNotification: async () => ({
          shouldPlaySound: true,
          shouldSetBadge: true,
          shouldShowBanner: true,
          shouldShowList: true,
        }),
      });
      subscription = Notifications.addNotificationReceivedListener((event) => {
        const data = event.request.content.data || {};
        setBanner({
          id: String(data.id || Date.now()),
          title: event.request.content.title || 'Notification',
          content: event.request.content.body || '',
          type: (data.type as UserNotification['type']) || 'SYSTEM',
          priority: (data.priority as UserNotification['priority']) || 'INFO',
          isRead: false,
          metadata: data,
          createdAt: new Date().toISOString(),
        });
      });
      const respond = (event: NotificationResponse) => {
        if (!active) return;
        const responseKey = `${event.notification.request.identifier}:${event.actionIdentifier}`;
        if (handledResponse.current === responseKey) return;
        handledResponse.current = responseKey;
        const content = event.notification.request.content;
        openNotification({ id: String(content.data?.id || ''), title: content.title || '', content: content.body || '', type: (content.data?.type as UserNotification['type']) || 'SYSTEM', priority: 'INFO', isRead: false, metadata: content.data || {}, createdAt: new Date().toISOString() }, user?.role);
        void Notifications.clearLastNotificationResponseAsync().catch(() => undefined);
      };
      responseSubscription = Notifications.addNotificationResponseReceivedListener(respond);
      void Notifications.getLastNotificationResponseAsync().then((event) => { if (event) respond(event); }).catch(() => undefined);
    }).catch((error) => {
      console.warn('[Notifications] Listener setup failed:', error);
    });

    return () => {
      active = false;
      subscription?.remove();
      responseSubscription?.remove();
    };
  }, [user?.role, isAuthenticated]);

  useEffect(() => {
    const handler = (payload: unknown) => setBanner(payload as UserNotification);
    socket.on('notification:new', handler);
    return () => socket.off('notification:new', handler);
  }, [socket]);

  return <InAppNotificationBanner notification={banner} onDismiss={() => setBanner(null)} onPress={() => { if (banner) openNotification(banner, user?.role); setBanner(null); }} />;
};
