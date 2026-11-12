import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { COLORS, CONTROL, MOTION, RADIUS, SPACE, SPACING } from '@/constants/theme';
import { typography } from '@/theme';
import { useLanguage } from '@/contexts/LanguageContext';

export const workflowStyles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.background },
  content: { padding: SPACING.lg, gap: SPACING.lg, paddingBottom: SPACE[32] },
  panel: { backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, padding: SPACING.lg, gap: SPACE[12] },
  title: { ...typography.h3, color: COLORS.textPrimary },
  body: { ...typography.body2, color: COLORS.textSecondary },
  amount: { ...typography.h1, color: COLORS.gold, fontVariant: ['tabular-nums'] },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE[8], alignItems: 'center' },
  input: {
    ...typography.body1,
    color: COLORS.textPrimary,
    backgroundColor: COLORS.surfaceElevated,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACE[16],
    paddingVertical: SPACE[12],
    minHeight: CONTROL.minHeight,
  },
  error: { ...typography.body2, color: COLORS.error },
  button: {
    backgroundColor: COLORS.gold,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACE[16],
    paddingVertical: SPACE[12],
    minHeight: CONTROL.minHeight,
    minWidth: CONTROL.minTouchSize,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: { ...typography.button, color: COLORS.textInverse, textAlign: 'center', flexShrink: 1 },
  chip: {
    backgroundColor: COLORS.surfaceElevated,
    borderRadius: RADIUS.md,
    minHeight: CONTROL.minTouchSize,
    paddingHorizontal: SPACE[16],
    paddingVertical: SPACE[8],
    borderWidth: 1,
    borderColor: 'transparent',
    justifyContent: 'center',
  },
  chipActive: {
    backgroundColor: COLORS.goldTint,
    borderColor: COLORS.gold,
    borderWidth: 1,
  },
});

export function WorkflowButton({
  title,
  onPress,
  disabled = false,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const { t } = useLanguage();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        workflowStyles.button,
        { opacity: disabled ? 0.55 : pressed ? 0.88 : 1 },
        pressed && !disabled && { transform: [{ scale: MOTION.pressedScale }] },
      ]}
    >
      <Text style={workflowStyles.buttonText}>{t(title)}</Text>
    </Pressable>
  );
}

export function WorkflowChip({
  children,
  selected,
  onPress,
}: {
  children: ReactNode;
  selected?: boolean;
  onPress: () => void;
}) {
  const { t } = useLanguage();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: Boolean(selected) }}
      onPress={onPress}
      style={({ pressed }) => [workflowStyles.chip, selected && workflowStyles.chipActive, pressed && { opacity: 0.88, transform: [{ scale: MOTION.pressedScale }] }]}
    >
      <Text style={[workflowStyles.body, selected && { color: COLORS.gold }]}>{typeof children === 'string' ? t(children) : children}</Text>
    </Pressable>
  );
}
