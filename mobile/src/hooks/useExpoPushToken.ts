import Constants from 'expo-constants';
import { useCallback, useEffect, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { ensureNotificationChannels } from './useNotificationPermissions';

import { authService } from '@/services/api/auth';
import { isExpoGo } from '@/utils/notificationRuntime';

export const useExpoPushToken = (enabled: boolean) => {
  const [expoPushToken, setExpoPushToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const register = useCallback(async () => {
    if (!enabled || isExpoGo || Platform.OS === 'web') return;
    setLoading(true);
    setError('');
    try {
      const Notifications = await import('expo-notifications');
      await ensureNotificationChannels();
      const projectId = Constants.expoConfig?.extra?.eas?.projectId || Constants.easConfig?.projectId;
      if (!projectId) throw new Error('Missing EAS project ID for push notifications.');
      const token = await Notifications.getExpoPushTokenAsync({ projectId });
      await authService.updatePushToken(token.data);
      setExpoPushToken(token.data);
    } catch (registerError) {
      console.warn('[Notifications] Push registration failed:', registerError);
      setError(
        registerError instanceof Error ? registerError.message : 'Push token registration failed.'
      );
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    void register();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void register();
    });
    return () => subscription.remove();
  }, [register]);

  return { expoPushToken, loading, error, register };
};
