import { useLanguage } from '@/contexts/LanguageContext';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { COLORS, CONTROL, RADIUS, SPACE, SPACING } from '@/constants/theme';
import { typography } from '@/theme';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

export interface EmptyStateProps {
  icon?: IoniconName;
  title: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
  accentColor?: string;
}

export function EmptyState({
  icon = 'information-circle-outline',
  title,
  message,
  actionLabel,
  onAction,
  accentColor = COLORS.gold,
}: EmptyStateProps) {
  const { t: translateUi } = useLanguage();
  return (
    <View style={styles.wrap}>
      <View style={styles.iconWrap}>
        <Ionicons name={icon} size={34} color={accentColor} />
      </View>
      <Text accessibilityRole="header" style={styles.title}>{translateUi(title)}</Text>
      {message ? <Text style={styles.message}>{translateUi(message)}</Text> : null}
      {actionLabel && onAction ? (
        <TouchableOpacity
          accessibilityRole="button"
          activeOpacity={0.8}
          style={[styles.action, { borderColor: accentColor }]}
          onPress={onAction}
        >
          <Text style={[styles.actionText, { color: accentColor }]}>{translateUi(actionLabel)}</Text>
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
    backgroundColor: COLORS.surface,
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
  action: {
    alignItems: 'center',
    borderRadius: RADIUS.md,
    borderWidth: 1,
    justifyContent: 'center',
    marginTop: SPACING.xs,
    minHeight: CONTROL.minHeight,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACE[12],
    maxWidth: '100%',
  },
  actionText: {
    ...typography.button,
    textAlign: 'center',
  },
});
