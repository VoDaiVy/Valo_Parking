import { useLanguage } from '@/contexts/LanguageContext';
import { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/common';
import { borderRadius, colors, spacing } from '@/theme';
import type { UserNotification } from '@/types/models';
import { getNotificationColor, getNotificationIcon } from '@/utils/notifications';

interface Props {
  notification: UserNotification | null;
  onDismiss: () => void;
  onPress: () => void;
}

export const InAppNotificationBanner = ({ notification, onDismiss, onPress }: Props) => {
  const { t: translateUi } = useLanguage();
  const insets = useSafeAreaInsets();
  useEffect(() => {
    if (!notification) return undefined;
    const timer = setTimeout(onDismiss, 5000);
    return () => clearTimeout(timer);
  }, [notification, onDismiss]);

  if (!notification) return null;

  return (
    <Pressable accessibilityRole="button" accessibilityLabel={notification.title} style={({ pressed }) => [styles.overlay, { top: insets.top + spacing.sm }, pressed && styles.pressed]} onPress={onPress}>
      <View style={[styles.icon, { backgroundColor: getNotificationColor(notification.priority) }]}>
        <AppText color={colors.light.text.inverse}>
          {getNotificationIcon(notification.type)}
        </AppText>
      </View>
      <View style={styles.body}>
        <AppText style={styles.title} variant="body2" numberOfLines={2}>{notification.title}</AppText>
        <AppText color={colors.light.text.secondary} variant="body2" numberOfLines={2}>
          {notification.content}
        </AppText>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={translateUi("Dismiss notification")} style={({ pressed }) => [styles.dismiss, pressed && styles.pressed]} onPress={onDismiss}>
        <AppText color={colors.light.text.secondary}>x</AppText>
      </Pressable>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  overlay: {
    alignItems: 'center',
    backgroundColor: colors.light.surface,
    borderColor: colors.light.border,
    borderRadius: borderRadius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    elevation: 3,
    flexDirection: 'row',
    gap: spacing.sm,
    left: spacing.lg,
    padding: spacing.md,
    position: 'absolute',
    right: spacing.lg,
    zIndex: 50,
  },
  icon: {
    alignItems: 'center',
    borderRadius: borderRadius.md,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  body: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xs,
  },
  title: {
    fontWeight: '700',
  },
  dismiss: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: borderRadius.md },
  pressed: { opacity: 0.85 },
});

