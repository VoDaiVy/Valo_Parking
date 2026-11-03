import { Pressable, StyleSheet } from 'react-native';

import { AppText } from '@/components/common';
import { colors } from '@/theme';
import { RADIUS } from '@/constants/theme';
import type { SlotStatus } from '@/types/booking.types';

interface ParkingSlotProps {
  slot: {
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    slotCode: string;
    status: SlotStatus;
  };
  onPress: (slotCode: string) => void;
  isSelected?: boolean;
}

const statusColors: Record<SlotStatus, string> = {
  available: colors.success.main,
  occupied: colors.error.main,
  reserved: colors.warning.main,
  maintenance: colors.neutral[400],
};

export const ParkingSlot = ({ slot, onPress, isSelected }: ParkingSlotProps) => (
  <Pressable
    accessibilityLabel={`${slot.slotCode} ${slot.status}`}
    accessibilityRole="button"
    accessibilityState={{ selected: Boolean(isSelected) }}
    onPress={() => onPress(slot.slotCode)}
    style={[
      styles.slot,
      {
        backgroundColor: statusColors[slot.status],
        height: slot.height,
        left: slot.x,
        top: slot.y,
        width: slot.width,
      },
      isSelected && styles.selected,
    ]}
  >
    <AppText
      color={colors.light.text.inverse}
      variant="caption"
    >
      {slot.slotCode}
    </AppText>
  </Pressable>
);

const styles = StyleSheet.create({
  slot: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'absolute',
    borderRadius: RADIUS.sm,
  },
  selected: {
    borderColor: colors.neutral.white,
    borderWidth: 3,
  },
});
