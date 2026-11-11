import { useLanguage } from '@/contexts/LanguageContext';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { ParkingSlot } from '@/components/booking/ParkingSlot';
import { AppText, Card } from '@/components/common';
import { Screen } from '@/components/layout/Screen';
import { useBooking } from '@/hooks/useBooking';
import type { BookingStackParamList } from '@/navigation/types';
import { borderRadius, colors, spacing } from '@/theme';
import type { SlotStatus } from '@/types/booking.types';

type Props = NativeStackScreenProps<BookingStackParamList, 'ParkingMap'>;

const legend: Array<{ label: string; status: SlotStatus; color: string }> = [
  { label: 'Available', status: 'available', color: colors.success.main },
  { label: 'Occupied', status: 'occupied', color: colors.error.main },
  { label: 'Reserved', status: 'reserved', color: colors.warning.main },
  { label: 'Maintenance', status: 'maintenance', color: colors.neutral[400] },
];

export const ParkingMapScreen = ({ route }: Props) => {
  const { t: translateUi } = useLanguage();
  const { availableSlots } = useBooking();
  const [selectedSlot, setSelectedSlot] = useState('');
  const floorId = route.params.floorId;

  const slots = useMemo(
    () =>
      availableSlots
        .filter((slot) => !floorId || slot.floorId === floorId)
        .map((slot, index) => ({
          id: `${slot.floorId}-${slot.slotCode}`,
          x: 16 + (index % 3) * 100,
          y: 16 + Math.floor(index / 3) * 80,
          width: 84,
          height: 56,
          slotCode: slot.slotCode,
          status: slot.status || 'available',
          zoneName: slot.zoneName,
        })),
    [availableSlots, floorId],
  );

  return (
    <Screen>
      <AppText variant="h1">{translateUi("Parking Map")}</AppText>
      <View style={styles.legend}>
        {legend.map((item) => (
          <View key={item.status} style={styles.legendItem}>
            <View style={[styles.dot, { backgroundColor: item.color }]} />
            <AppText variant="caption">{translateUi(item.label)}</AppText>
          </View>
        ))}
      </View>
      <ScrollView horizontal>
        <ScrollView>
          <View style={styles.canvas}>
            {slots.map((slot) => (
              <ParkingSlot
                key={slot.id}
                isSelected={selectedSlot === slot.slotCode}
                slot={slot}
                onPress={setSelectedSlot}
              />
            ))}
          </View>
        </ScrollView>
      </ScrollView>
      {selectedSlot ? (
        <Card style={styles.selection}>
          <AppText variant="h3">{translateUi("Slot")}{" "}{selectedSlot}</AppText>
          <AppText color={colors.light.text.secondary}>{translateUi("Tap another slot to inspect it.")}</AppText>
        </Card>
      ) : null}
    </Screen>
  );
};

const styles = StyleSheet.create({
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  legendItem: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  dot: {
    borderRadius: 6,
    height: 12,
    width: 12,
  },
  canvas: {
    borderRadius: borderRadius.lg,
    backgroundColor: colors.neutral[100],
    height: 520,
    position: 'relative',
    width: 360,
  },
  selection: { gap: spacing.sm },
});
