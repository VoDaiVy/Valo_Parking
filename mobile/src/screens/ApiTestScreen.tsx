import { useLanguage } from '@/contexts/LanguageContext';
import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS, CONTROL, MOTION, RADIUS, SPACE } from '@/constants/theme';
import { typography } from '@/theme';

import { testBackendConnection } from '../api/auth.api';
import type { NormalizedApiError } from '../api/axiosClient';
import { API_URL } from '../constants/env';

type RequestState = 'idle' | 'loading' | 'success' | 'error';

export default function ApiTestScreen() {
  const { t: translateUi } = useLanguage();
  const [status, setStatus] = useState<RequestState>('idle');
  const [message, setMessage] = useState('Press the button to test backend connectivity.');

  const handleTestApi = async () => {
    setStatus('loading');
    setMessage('Calling backend...');

    try {
      const data = await testBackendConnection();
      setStatus('success');
      setMessage(data.message || data.status || 'Backend connection successful.');
    } catch (error) {
      const apiError = error as NormalizedApiError;
      setStatus('error');
      setMessage(apiError.message || 'Cannot connect to backend.');
    }
  };

  const isLoading = status === 'loading';

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>{translateUi("Mobile API Test")}</Text>
          <Text style={styles.subtitle}>{API_URL}</Text>
        </View>

        <View style={styles.panel}>
          <Text style={[styles.status, styles[status]]}>{status.toUpperCase()}</Text>
          <Text style={styles.message}>{message}</Text>

          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: isLoading, busy: isLoading }}
            disabled={isLoading}
            onPress={handleTestApi}
            style={({ pressed }) => [
              styles.button,
              isLoading && styles.buttonDisabled,
              pressed && !isLoading && styles.buttonPressed,
            ]}
          >
            {isLoading ? (
              <ActivityIndicator color={COLORS.textInverse} />
            ) : (
              <Text style={styles.buttonText}>{translateUi("Test API")}</Text>
            )}
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  container: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: SPACE[24],
    width: '100%',
    maxWidth: 480,
    alignSelf: 'center',
  },
  header: {
    marginBottom: SPACE[24],
  },
  title: {
    ...typography.h2,
    color: COLORS.textPrimary,
  },
  subtitle: {
    ...typography.body2,
    color: COLORS.textSecondary,
    marginTop: SPACE[8],
  },
  panel: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    padding: SPACE[24],
  },
  status: {
    ...typography.caption,
    fontWeight: '700',
    marginBottom: SPACE[12],
  },
  idle: {
    color: COLORS.textSecondary,
  },
  loading: {
    color: COLORS.gold,
  },
  success: {
    color: COLORS.success,
  },
  error: {
    color: COLORS.error,
  },
  message: {
    ...typography.body1,
    color: COLORS.textPrimary,
    marginBottom: SPACE[24],
  },
  button: {
    alignItems: 'center',
    backgroundColor: COLORS.gold,
    borderRadius: RADIUS.md,
    minHeight: CONTROL.minHeight,
    justifyContent: 'center',
    paddingHorizontal: SPACE[16],
    paddingVertical: SPACE[12],
  },
  buttonDisabled: {
    opacity: 0.55,
  },
  buttonPressed: {
    backgroundColor: COLORS.goldPressed,
    transform: [{ scale: MOTION.pressedScale }],
  },
  buttonText: {
    ...typography.button,
    color: COLORS.textInverse,
    textAlign: 'center',
  },
});
