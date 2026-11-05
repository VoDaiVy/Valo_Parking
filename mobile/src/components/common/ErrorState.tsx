import { useLanguage } from '@/contexts/LanguageContext';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { COLORS, CONTROL, RADIUS, SPACE, SPACING } from '@/constants/theme';
import { typography } from '@/theme';

export interface ErrorStateProps {
  title?: string;
  message: string;
  retryLabel?: string;
  onRetry?: () => void;
}

export function ErrorState({
  title = 'Unable to load data',
  message,
  retryLabel = 'Try again',
  onRetry,
}: ErrorStateProps) {
  const { t: translateUi } = useLanguage();
  return (
    <View style={styles.wrap}>
      <View style={styles.iconWrap}>
        <Ionicons name="warning-outline" size={30} color={COLORS.error} />
      </View>
      <Text accessibilityRole="header" style={styles.title}>{translateUi(title)}</Text>
      <Text style={styles.message}>{translateUi(message)}</Text>
      {onRetry ? (
        <TouchableOpacity
          accessibilityRole="button"
          activeOpacity={0.8}
          style={styles.retry}
          onPress={onRetry}
        >
          <Ionicons name="refresh" size={16} color={COLORS.textInverse} />
          <Text style={styles.retryText}>{translateUi(retryLabel)}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    gap: SPACE[12],
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.xl,
  },
  iconWrap: {
    alignItems: 'center',
    backgroundColor: COLORS.errorTint,
    borderRadius: RADIUS.xl,
    height: SPACE[64],
    justifyContent: 'center',
    width: SPACE[64],
    marginBottom: SPACE[4],
  },
  title: {
    ...typography.h3,
    color: COLORS.textPrimary,
    maxWidth: 360,
    textAlign: 'center',
  },
  message: {
    ...typography.body2,
    color: COLORS.textSecondary,
    maxWidth: 360,
    textAlign: 'center',
  },
  retry: {
    alignItems: 'center',
    backgroundColor: COLORS.gold,
    borderRadius: RADIUS.md,
    flexDirection: 'row',
    gap: SPACE[8],
    justifyContent: 'center',
    marginTop: SPACING.xs,
    minHeight: CONTROL.minHeight,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACE[12],
    maxWidth: '100%',
  },
  retryText: {
    ...typography.button,
    color: COLORS.textInverse,
    flexShrink: 1,
    textAlign: 'center',
  },
});
