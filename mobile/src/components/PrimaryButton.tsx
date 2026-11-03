import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  TouchableOpacityProps,
} from 'react-native';

import { COLORS, CONTROL, RADIUS, SPACE } from '../constants/theme';
import { typography } from '@/theme';
import { useLanguage } from '@/contexts/LanguageContext';

interface PrimaryButtonProps extends TouchableOpacityProps {
  title: string;
  loading?: boolean;
  variant?: 'gold' | 'outline';
}

export default function PrimaryButton({
  title,
  loading = false,
  disabled,
  variant = 'gold',
  style,
  ...props
}: PrimaryButtonProps) {
  const { t } = useLanguage();
  const isDisabled = disabled || loading;

  if (variant === 'outline') {
    return (
      <TouchableOpacity
        activeOpacity={0.75}
        accessibilityRole="button"
        accessibilityLabel={t(title)}
        accessibilityState={{ disabled: isDisabled, busy: loading }}
        disabled={isDisabled}
        style={[styles.base, styles.outline, isDisabled && styles.disabled, style as object]}
        {...props}
      >
        {loading ? <ActivityIndicator color={COLORS.gold} size="small" /> : <Text style={styles.outlineText}>{t(title)}</Text>}
      </TouchableOpacity>
    );
  }

  return (
    <TouchableOpacity
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityLabel={t(title)}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      disabled={isDisabled}
      style={[styles.base, isDisabled && styles.disabled, style as object]}
      {...props}
    >
      <LinearGradient
        colors={COLORS.gradientGold}
        end={{ x: 1, y: 0 }}
        start={{ x: 0, y: 0 }}
        style={styles.gradient}
      >
        {loading ? (
          <ActivityIndicator color={COLORS.textInverse} size="small" />
        ) : (
          <Text style={styles.goldText}>{t(title)}</Text>
        )}
      </LinearGradient>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: RADIUS.md,
    minHeight: CONTROL.minHeight,
    minWidth: CONTROL.minTouchSize,
    overflow: 'hidden',
    shadowColor: COLORS.background,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 4,
    elevation: 1,
  },
  gradient: {
    flexGrow: 1,
    minHeight: CONTROL.minHeight,
    paddingHorizontal: SPACE[16],
    paddingVertical: SPACE[12],
    alignItems: 'center',
    justifyContent: 'center',
  },
  goldText: {
    ...typography.button,
    color: COLORS.textInverse,
    textAlign: 'center',
  },
  outline: {
    borderWidth: 1,
    borderColor: COLORS.gold,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
    shadowColor: 'transparent',
    elevation: 0,
    paddingHorizontal: SPACE[16],
    paddingVertical: SPACE[12],
  },
  outlineText: {
    ...typography.button,
    color: COLORS.gold,
    textAlign: 'center',
  },
  disabled: {
    opacity: 0.55,
  },
});
