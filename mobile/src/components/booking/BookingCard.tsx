import { useLanguage } from '@/contexts/LanguageContext';
import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';
import { format } from 'date-fns';

import { AppText, Card } from '@/components/common';
import { colors, spacing } from '@/theme';
import { MOTION, RADIUS } from '@/constants/theme';
import type { Booking, ParkingFloor } from '@/types/booking.types';
import { formatCurrency } from '@/utils/formatters';

import { StatusBadge } from './StatusBadge';

interface BookingCardProps {
  booking: Booking;
  onPress: () => void;
}

const floorName = (floorId: Booking['floorId']) => {
  if (typeof floorId === 'string') {
    return floorId;
  }

  return (floorId as ParkingFloor).name;
};

export const BookingCard = ({ booking, onPress }: BookingCardProps) => { const { t: translateUi } = useLanguage(); return (
  <Pressable
    accessibilityLabel={`Booking ${booking.slotCode}, license plate ${booking.licensePlate}`}
    accessibilityRole="button"
    onPress={onPress}
    style={({ pressed }) => pressed && styles.pressed}
  >
    <Card style={styles.card}>
      <View style={styles.row}>
        <View style={styles.slotIdentity}>
          <View style={styles.iconWrap}>
            <Ionicons name="location" size={19} color={colors.primary[500]} />
          </View>
          <View style={styles.slotCopy}>
            <AppText variant="h3">{booking.slotCode}</AppText>
            <AppText color={colors.light.text.secondary} numberOfLines={1} variant="body2">
              {floorName(booking.floorId)}
            </AppText>
          </View>
        </View>
        <StatusBadge status={booking.status} />
      </View>
      <View style={styles.detailRow}>
        <Ionicons name="time-outline" size={16} color={colors.light.text.secondary} />
        <AppText color={colors.light.text.secondary} style={styles.timeText} variant="body2">
          {format(new Date(booking.startTime), 'dd/MM/yyyy HH:mm')} -{' '}
          {format(new Date(booking.endTime), 'HH:mm')}
        </AppText>
      </View>
      <View style={styles.footerRow}>
        <View style={[styles.detailRow, styles.footerDetail]}>
          <Ionicons name="car-outline" size={16} color={colors.light.text.secondary} />
          <AppText color={colors.light.text.secondary} style={styles.plate} numberOfLines={1} variant="body2">
            {booking.licensePlate}
          </AppText>
        </View>
        <View style={styles.amountWrap}>
          <AppText color={colors.light.text.secondary} variant="caption">{translateUi("Total")}</AppText>
          <AppText color={colors.primary[500]} style={styles.amount} variant="h3">
            {formatCurrency(booking.finalAmount || booking.totalAmount || 0)}
          </AppText>
        </View>
      </View>
    </Card>
  </Pressable>
); };

const styles = StyleSheet.create({
  card: {
    gap: spacing.lg,
    marginBottom: spacing.lg,
  },
  amountWrap: {
    alignItems: 'flex-end',
    flexShrink: 1,
    maxWidth: '100%',
  },
  detailRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    minWidth: 0,
  },
  footerRow: {
    alignItems: 'flex-end',
    borderTopColor: colors.light.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: spacing.md,
    paddingTop: spacing.md,
  },
  footerDetail: {
    flexGrow: 1,
    flexBasis: 100,
    flexShrink: 1,
    marginRight: spacing.sm,
  },
  iconWrap: {
    alignItems: 'center',
    backgroundColor: colors.primary[50],
    borderRadius: RADIUS.md,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  pressed: {
    opacity: 0.92,
    transform: [{ scale: MOTION.pressedScale }],
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  slotIdentity: {
    alignItems: 'center',
    flexDirection: 'row',
    flex: 1,
    flexBasis: 140,
    gap: spacing.md,
    minWidth: 0,
  },
  slotCopy: {
    flex: 1,
    minWidth: 0,
  },
  timeText: { flex: 1, minWidth: 0, fontVariant: ['tabular-nums'] },
  plate: { flexShrink: 1, fontVariant: ['tabular-nums'] },
  amount: { textAlign: 'right', fontVariant: ['tabular-nums'] },
});
