import { useLanguage } from '@/contexts/LanguageContext';
import { Pressable, PressableProps, StyleProp, StyleSheet, ViewStyle } from 'react-native';

import { borderRadius, colors } from '@/theme';
import { CONTROL, MOTION } from '@/constants/theme';

import { AppText } from './AppText';

export interface IconButtonProps extends Omit<PressableProps, 'style'> {
  icon: string;
  label: string;
  style?: StyleProp<ViewStyle>;
}

export const IconButton = ({ icon, label, style, disabled, ...props }: IconButtonProps) => { const { t: translateUi } = useLanguage(); return (
  <Pressable
    accessibilityLabel={translateUi(label)}
    accessibilityRole="button"
    accessibilityState={{ disabled: Boolean(disabled) }}
    disabled={disabled}
    style={({ pressed }) => [styles.base, disabled && styles.disabled, pressed && !disabled && styles.pressed, style]}
    {...props}
  >
    <AppText style={styles.icon}>{icon}</AppText>
  </Pressable>
); };

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    backgroundColor: colors.light.surfaceElevated,
    borderRadius: borderRadius.md,
    minHeight: CONTROL.minHeight,
    justifyContent: 'center',
    minWidth: CONTROL.minHeight,
  },
  icon: {
    fontSize: CONTROL.iconSize,
    lineHeight: 24,
  },
  pressed: {
    opacity: 0.9,
    transform: [{ scale: MOTION.pressedScale }],
  },
  disabled: { opacity: 0.55 },
});
