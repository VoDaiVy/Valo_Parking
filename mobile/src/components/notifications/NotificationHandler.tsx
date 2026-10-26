import { useEffect, useState } from 'react';

import { useExpoPushToken } from '@/hooks/useExpoPushToken';
import { useNotificationPermissions } from '@/hooks/useNotificationPermissions';
import { useSocket } from '@/hooks/useSocket';
import { useAuth } from '@/hooks/useAuth';
import { openNotification } from '@/navigation/notificationNavigation';
import type { UserNotification } from '@/types/models';
import { isExpoGo } from '@/utils/notificationRuntime';

import { InAppNotificationBanner } from './InAppNotificationBanner';

export const NotificationHandler = () => {
  const socket = useSocket();
  const { user, isAuthenticated } = useAuth();
  const permissions = useNotificationPermissions();
  useExpoPushToken(isAuthenticated && permissions.status === 'granted');
  const [banner, setBanner] = useState<UserNotification | null>(null);

  useEffect(() => {
    if (permissions.status === 'undetermined' && !permissions.loading) {
      void permissions.requestPermission();
    }
  }, [permissions]);

  useEffect(() => {
    if (isExpoGo) return undefined;

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
      responseSubscription = Notifications.addNotificationResponseReceivedListener((event) => {
        const content = event.notification.request.content;
        openNotification({ id: String(content.data?.id || ''), title: content.title || '', content: content.body || '', type: (content.data?.type as UserNotification['type']) || 'SYSTEM', priority: 'INFO', isRead: false, metadata: content.data || {}, createdAt: new Date().toISOString() }, user?.role);
      });
    });

    return () => {
      active = false;
      subscription?.remove();
      responseSubscription?.remove();
    };
  }, [user?.role]);

  useEffect(() => {
    const handler = (payload: unknown) => setBanner(payload as UserNotification);
    socket.on('notification:new', handler);
    return () => socket.off('notification:new', handler);
  }, [socket]);

  return <InAppNotificationBanner notification={banner} onDismiss={() => setBanner(null)} onPress={() => { if (banner) openNotification(banner, user?.role); setBanner(null); }} />;
};
