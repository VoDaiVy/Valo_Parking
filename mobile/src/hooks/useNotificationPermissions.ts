import { useCallback, useEffect, useState } from 'react';
import { Platform } from 'react-native';

import { isExpoGo } from '@/utils/notificationRuntime';

type PermissionStatus = 'undetermined' | 'granted' | 'denied' | 'unsupported';

export const useNotificationPermissions = () => {
  const [status, setStatus] = useState<PermissionStatus>(isExpoGo ? 'unsupported' : 'undetermined');
  const [loading, setLoading] = useState(!isExpoGo);

  const checkPermissionStatus = useCallback(async () => {
    if (isExpoGo) {
      setStatus('unsupported');
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const Notifications = await import('expo-notifications');
      const permission = await Notifications.getPermissionsAsync();
      setStatus(permission.status as PermissionStatus);
    } finally {
      setLoading(false);
    }
  }, []);

  const requestPermission = useCallback(async () => {
    if (isExpoGo) {
      setStatus('unsupported');
      return false;
    }
    setLoading(true);
    try {
      const Notifications = await import('expo-notifications');
      if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync('default', {
          name: 'Default',
          importance: Notifications.AndroidImportance.HIGH,
          vibrationPattern: [0, 250, 250, 250],
          sound: 'default',
        });
        await Notifications.setNotificationChannelAsync('valo-notifications', {
          name: 'VALO Notifications',
          importance: Notifications.AndroidImportance.HIGH,
          vibrationPattern: [0, 250, 250, 250],
          sound: 'default',
        });
      }
      const permission = await Notifications.requestPermissionsAsync();
      setStatus(permission.status as PermissionStatus);
      return permission.status === 'granted';
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void checkPermissionStatus();
  }, [checkPermissionStatus]);

  return { status, loading, checkPermissionStatus, requestPermission };
};

