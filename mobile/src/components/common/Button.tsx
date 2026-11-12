import {
  ActivityIndicator,
  Pressable,
  PressableProps,
  StyleProp,
  StyleSheet,
  TextStyle,
  ViewStyle,
} from 'react-native';

import { borderRadius, colors, spacing, typography } from '@/theme';
import { CONTROL, MOTION } from '@/constants/theme';
import { useLanguage } from '@/contexts/LanguageContext';

import { AppText } from './AppText';

type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost';

export interface ButtonProps extends Omit<PressableProps, 'style'> {
  title: string;
  variant?: ButtonVariant;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
}

const getVariantStyle = (variant: ButtonVariant) => {
  switch (variant) {
    case 'secondary':
      return {
        button: styles.secondary,
        text: styles.secondaryText,
      };
    case 'outline':
      return {
        button: styles.outline,
        text: styles.outlineText,
      };
    case 'ghost':
      return {
        button: styles.ghost,
        text: styles.ghostText,
      };
    case 'primary':
    default:
      return {
        button: styles.primary,
        text: styles.primaryText,
      };
  }
};

export const Button = ({
  title,
  variant = 'primary',
  loading = false,
  disabled,
  style,
  textStyle,
  accessibilityLabel,
  ...props
}: ButtonProps) => {
  const { t } = useLanguage();
  const variantStyle = getVariantStyle(variant);
  const isDisabled = disabled || loading;

  return (
    <Pressable
      accessibilityLabel={accessibilityLabel || t(title)}
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.base,
        variantStyle.button,
        isDisabled && styles.disabled,
        pressed && !isDisabled && styles.pressed,
        style,
      ]}
      {...props}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'primary' || variant === 'secondary' ? colors.light.text.inverse : colors.primary[600]} />
      ) : (
        <AppText style={[styles.text, variantStyle.text, textStyle]}>{t(title)}</AppText>
      )}
    </Pressable>
  );
};

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    borderRadius: borderRadius.md,
    justifyContent: 'center',
    minHeight: CONTROL.minHeight,
    minWidth: CONTROL.minTouchSize,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  text: {
    ...typography.button,
    textAlign: 'center',
    flexShrink: 1,
  },
  primary: {
    backgroundColor: colors.primary[500],
  },
  primaryText: {
    color: colors.light.text.inverse,
  },
  secondary: {
    backgroundColor: colors.secondary[500],
  },
  secondaryText: {
    color: colors.light.text.inverse,
  },
  outline: {
    backgroundColor: colors.light.surface,
    borderColor: colors.primary[500],
    borderWidth: 1,
  },
  outlineText: {
    color: colors.primary[600],
  },
  ghost: {
    backgroundColor: 'transparent',
  },
  ghostText: {
    color: colors.primary[600],
  },
  disabled: {
    opacity: 0.55,
  },
  pressed: {
    opacity: 0.88,
    transform: [{ scale: MOTION.pressedScale }],
  },
});
