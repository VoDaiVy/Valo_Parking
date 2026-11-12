import { useLanguage } from '@/contexts/LanguageContext';
import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { COLORS, FONT_SIZES, RADIUS, SPACING } from '@/constants/theme';
import { typography } from '@/theme';
import type { NotificationPriority, NotificationType, UserNotification } from '@/types/models';
import { formatNotificationTimestamp } from '@/utils/notifications';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

interface Props {
  notification: UserNotification;
  onPress: () => void;
  onDelete: () => void;
}

const TYPE_ICON: Record<NotificationType, IoniconName> = {
  SYSTEM: 'information-circle-outline',
  PARKING: 'car-outline',
  BOOKING: 'calendar-outline',
  WALLET: 'wallet-outline',
  PAYMENT: 'card-outline',
  ACCOUNT: 'person-outline',
  PROMOTION: 'pricetag-outline',
  CAMERA: 'camera-outline',
  VIOLATION: 'alert-circle-outline',
};

const PRIORITY_COLOR: Record<NotificationPriority, string> = {
  INFO: COLORS.staffBlue,
  SUCCESS: COLORS.success,
  WARNING: COLORS.warning,
  ERROR: COLORS.error,
  SYSTEM: COLORS.gold,
};

export const NotificationCard = ({ notification, onPress, onDelete }: Props) => {
  const { t: translateUi, language } = useLanguage();
  const accentColor = PRIORITY_COLOR[notification.priority] ?? COLORS.gold;

  return (
    <View style={[styles.card, !notification.isRead && { borderColor: `${accentColor}55` }]}>
      <Pressable accessibilityRole="button" accessibilityLabel={notification.title} style={({ pressed }) => [styles.content, pressed && styles.pressed]} onPress={onPress}>
        <View style={[styles.icon, { backgroundColor: `${accentColor}18` }]}>
          <Ionicons name={TYPE_ICON[notification.type] ?? 'notifications-outline'} size={22} color={accentColor} />
        </View>
        <View style={styles.body}>
          <View style={styles.titleRow}>
            <Text style={[styles.title, !notification.isRead && styles.titleUnread, !notification.isRead && { color: accentColor }]} numberOfLines={2}>
              {notification.title}
            </Text>
            {!notification.isRead ? <View style={[styles.unreadDot, { backgroundColor: accentColor }]} /> : null}
          </View>
          <Text style={styles.contentText} numberOfLines={2}>
            {notification.content}
          </Text>
          <Text style={styles.timestamp}>{formatNotificationTimestamp(notification.createdAt, undefined, language)}</Text>
        </View>
      </Pressable>

      <TouchableOpacity
        accessibilityLabel={translateUi("Delete notification")}
        accessibilityRole="button"
        activeOpacity={0.75}
        style={styles.deleteButton}
        onPress={onDelete}
      >
        <Ionicons name="trash-outline" size={18} color={COLORS.textMuted} />
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderRadius: RADIUS.lg,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: SPACING.xs,
    marginBottom: SPACING.md,
    padding: SPACING.md,
  },
  content: {
    flex: 1,
    flexDirection: 'row',
    gap: SPACING.sm,
    minHeight: 44,
  },
  icon: {
    alignItems: 'center',
    borderRadius: RADIUS.md,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  body: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  titleRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: SPACING.xs,
  },
  title: {
    ...typography.body2,
    color: COLORS.textPrimary,
    flex: 1,
    fontSize: FONT_SIZES.sm,
    fontWeight: '600',
    lineHeight: 20,
  },
  titleUnread: {
    fontWeight: '700',
  },
  unreadDot: {
    borderRadius: 4,
    height: 8,
    marginTop: 6,
    width: 8,
  },
  contentText: {
    ...typography.body2,
    color: COLORS.textSecondary,
  },
  timestamp: {
    ...typography.caption,
    color: COLORS.textMuted,
    fontSize: FONT_SIZES.xs,
  },
  deleteButton: {
    alignItems: 'center',
    borderRadius: RADIUS.round,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  pressed: { opacity: 0.8 },
});
