import { useLanguage } from '@/contexts/LanguageContext';
import { useState } from 'react';
import {
  KeyboardTypeOptions,
  StyleProp,
  StyleSheet,
  TextInput,
  TextInputProps,
  View,
  ViewStyle,
} from 'react-native';

import { borderRadius, colors, spacing, typography } from '@/theme';
import { CONTROL } from '@/constants/theme';

import { AppText } from './AppText';

export interface InputProps extends TextInputProps {
  label?: string;
  error?: string;
  containerStyle?: StyleProp<ViewStyle>;
  keyboardType?: KeyboardTypeOptions;
}

export const Input = ({
  label,
  error,
  containerStyle,
  style,
  accessibilityLabel,
  onFocus,
  onBlur,
  ...props
}: InputProps) => {
  const { t: translateUi } = useLanguage();
  const [focused, setFocused] = useState(false);
  return (
  <View style={[styles.container, containerStyle]}>
    {label ? (
      <AppText color={colors.light.text.secondary} style={styles.label} variant="body2">
        {translateUi(label)}
      </AppText>
    ) : null}
    <TextInput
      accessibilityLabel={accessibilityLabel || label || props.placeholder}
      autoCapitalize="none"
      placeholderTextColor={colors.neutral[400]}
      style={[styles.input, focused && styles.inputFocused, props.editable === false && styles.disabled, error && styles.inputError, style]}
      {...props}
      onFocus={(event) => { setFocused(true); onFocus?.(event); }}
      onBlur={(event) => { setFocused(false); onBlur?.(event); }}
    />
    {error ? (
      <AppText color={colors.error.main} style={styles.error} variant="caption">
        {translateUi(error)}
      </AppText>
    ) : null}
  </View>
  );
};

const styles = StyleSheet.create({
  container: {
    gap: spacing.sm,
  },
  label: {
    fontWeight: '600',
  },
  input: {
    ...typography.body1,
    backgroundColor: colors.light.surface,
    borderColor: colors.light.border,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    color: colors.light.text.primary,
    minHeight: CONTROL.minHeight,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  inputError: {
    borderColor: colors.error.main,
  },
  inputFocused: {
    borderColor: colors.primary[500],
    backgroundColor: colors.light.surfaceElevated,
  },
  disabled: { opacity: 0.55 },
  error: {
    marginTop: spacing.xs,
  },
});
