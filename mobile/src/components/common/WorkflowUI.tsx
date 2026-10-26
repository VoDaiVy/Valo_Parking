import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { COLORS, RADIUS, SPACING } from '@/constants/theme';

export const workflowStyles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.background },
  content: { padding: SPACING.lg, gap: SPACING.lg, paddingBottom: 32 },
  panel: { backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, padding: SPACING.lg, gap: 10 },
  title: { color: COLORS.textPrimary, fontSize: 18, fontWeight: '700' },
  body: { color: COLORS.textSecondary, fontSize: 14, lineHeight: 22 },
  amount: { color: COLORS.gold, fontSize: 28, fontWeight: '800', fontVariant: ['tabular-nums'] },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  input: {
    color: COLORS.textPrimary,
    backgroundColor: COLORS.surfaceElevated,
    borderRadius: RADIUS.md,
    padding: 14,
    minHeight: 48,
  },
  error: { color: COLORS.error, fontSize: 14, lineHeight: 22 },
  button: {
    backgroundColor: COLORS.gold,
    borderRadius: RADIUS.md,
    paddingHorizontal: 18,
    paddingVertical: 14,
    minHeight: 48,
    alignItems: 'center',
  },
  buttonText: { color: COLORS.textInverse, fontWeight: '700', fontSize: 14 },
  chip: {
    backgroundColor: COLORS.surfaceElevated,
    borderRadius: RADIUS.md,
    minHeight: 44,
    paddingHorizontal: 14,
    justifyContent: 'center',
  },
  chipActive: {
    backgroundColor: 'rgba(212,175,55,0.18)',
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
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        workflowStyles.button,
        { opacity: disabled ? 0.4 : pressed ? 0.75 : 1 },
      ]}
    >
      <Text style={workflowStyles.buttonText}>{title}</Text>
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
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: Boolean(selected) }}
      onPress={onPress}
      style={[workflowStyles.chip, selected && workflowStyles.chipActive]}
    >
      <Text style={[workflowStyles.body, selected && { color: COLORS.gold }]}>{children}</Text>
    </Pressable>
  );
}
