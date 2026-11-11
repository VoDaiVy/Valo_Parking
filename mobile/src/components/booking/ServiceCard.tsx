import { useLanguage } from '@/contexts/LanguageContext';
import { Ionicons } from '@expo/vector-icons';
import { Image, Pressable, StyleSheet, View } from 'react-native';

import { AppText, Card } from '@/components/common';
import { borderRadius, colors, spacing } from '@/theme';
import { CONTROL, MOTION } from '@/constants/theme';
import type { Service } from '@/types/booking.types';
import { formatCurrency } from '@/utils/formatters';

interface ServiceCardProps {
  service: Service;
  selected: boolean;
  onToggle: () => void;
  isFree?: boolean;
}

export const ServiceCard = ({ service, selected, onToggle, isFree = false }: ServiceCardProps) => { const { t: translateUi } = useLanguage(); return (
  <Pressable accessibilityLabel={service.name} accessibilityRole="checkbox" accessibilityState={{ checked: selected }} style={({ pressed }) => pressed && styles.pressed} onPress={onToggle}>
    <Card style={[styles.card, selected && styles.selected]}>
      {service.imageUrl || service.image ? (
        <Image source={{ uri: service.imageUrl || service.image }} style={styles.image} />
      ) : null}
      <View style={styles.content}>
        <AppText style={styles.name}>{service.name}</AppText>
        {service.description ? (
          <AppText color={colors.light.text.secondary} variant="body2">
            {service.description}
          </AppText>
        ) : null}
        <View style={styles.row}>
          <AppText color={isFree ? colors.success.main : colors.primary[600]} style={styles.price} variant="body2">
            {isFree ? translateUi("FREE") : formatCurrency(service.price)}
          </AppText>
          <AppText color={colors.light.text.secondary} variant="caption">
            {service.estimatedTimeMinutes || service.estimatedTime || 0} {" "}{translateUi("min")}{" "}</AppText>
        </View>
      </View>
      <View style={[styles.checkbox, selected && styles.checkboxSelected]}>
        {selected ? <Ionicons name="checkmark" size={18} color={colors.light.text.inverse} /> : null}
      </View>
    </Card>
  </Pressable>
); };

const styles = StyleSheet.create({
  card: {
    alignItems: 'flex-start',
    borderWidth: 1,
    borderColor: 'transparent',
    minHeight: CONTROL.minHeight,
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  selected: {
    borderColor: colors.primary[500],
  },
  image: {
    borderRadius: borderRadius.md,
    height: 64,
    width: 64,
  },
  content: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xs,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  checkbox: {
    alignItems: 'center',
    borderColor: colors.light.border,
    borderRadius: borderRadius.sm,
    borderWidth: 1,
    height: 28,
    justifyContent: 'center',
    width: 28,
  },
  checkboxSelected: {
    backgroundColor: colors.primary[500],
    borderColor: colors.primary[500],
  },
  name: { fontWeight: '600' },
  price: { fontWeight: '600', fontVariant: ['tabular-nums'] },
  pressed: { opacity: 0.88, transform: [{ scale: MOTION.pressedScale }] },
});
