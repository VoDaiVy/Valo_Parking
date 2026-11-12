import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/common';
import { borderRadius, colors, spacing } from '@/theme';
import type { BookingStatus } from '@/types/booking.types';
import { useLanguage } from '@/contexts/LanguageContext';

const statusColor: Record<BookingStatus, string> = {
  pending: colors.warning.main,
  confirmed: colors.primary[500],
  active: colors.success.main,
  paused: colors.warning.main,
  completed: colors.success.main,
  cancelled: colors.error.main,
  expired: colors.warning.main,
};

export const StatusBadge = ({ status }: { status: BookingStatus }) => {
  const { t } = useLanguage();
  return (
  <View
    style={[
      styles.badge,
      { backgroundColor: `${statusColor[status]}18`, borderColor: `${statusColor[status]}55` },
    ]}
  >
    <AppText color={statusColor[status]} style={styles.text} variant="caption">
      {t(status.toUpperCase())}
    </AppText>
  </View>
  );
};

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    borderRadius: borderRadius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    maxWidth: '100%',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  text: {
    fontWeight: '600',
  },
});
