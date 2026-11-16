import { useCallback, useEffect, useState } from 'react';
import { AppState, Platform } from 'react-native';

import { isExpoGo } from '@/utils/notificationRuntime';

export async function ensureNotificationChannels() {
  if (Platform.OS !== 'android' || isExpoGo) return;
  const Notifications: typeof import('expo-notifications') = require('expo-notifications');
  for (const [id, name] of [['default', 'General'], ['valo-notifications', 'VALO Parking']]) {
    await Notifications.setNotificationChannelAsync(id, {
      name,
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      // Omitting sound uses Android's system notification sound. An explicit
      // string is treated as a bundled sound filename by this native module.
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
    });
  }
}

type PermissionStatus = 'undetermined' | 'granted' | 'denied' | 'unsupported';

export const useNotificationPermissions = () => {
  const [status, setStatus] = useState<PermissionStatus>(isExpoGo ? 'unsupported' : 'undetermined');
  const [loading, setLoading] = useState(!isExpoGo);

  const checkPermissionStatus = useCallback(async () => {
    if (isExpoGo || Platform.OS === 'web') {
      setStatus('unsupported');
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const Notifications: typeof import('expo-notifications') = require('expo-notifications');
      await ensureNotificationChannels();
      const permission = await Notifications.getPermissionsAsync();
      setStatus(permission.status as PermissionStatus);
    } catch (error) {
      console.warn('[Notifications] Permission operation failed:', error);
      setStatus('denied');
    } finally {
      setLoading(false);
    }
  }, []);

  const requestPermission = useCallback(async () => {
    if (isExpoGo || Platform.OS === 'web') {
      setStatus('unsupported');
      return false;
    }
    setLoading(true);
    try {
      const Notifications: typeof import('expo-notifications') = require('expo-notifications');
      await ensureNotificationChannels();
      const permission = await Notifications.requestPermissionsAsync();
      setStatus(permission.status as PermissionStatus);
      return permission.status === 'granted';
    } catch (error) {
      console.warn('[Notifications] Permission operation failed:', error);
      setStatus('denied');
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void checkPermissionStatus();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void checkPermissionStatus();
    });
    return () => subscription.remove();
  }, [checkPermissionStatus]);

  return { status, loading, checkPermissionStatus, requestPermission };
};

