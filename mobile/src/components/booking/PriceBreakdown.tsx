import { useLanguage } from '@/contexts/LanguageContext';
import { StyleSheet, View } from 'react-native';

import { AppText, Card } from '@/components/common';
import { colors, spacing } from '@/theme';
import { formatCurrency } from '@/utils/formatters';

interface PriceBreakdownProps {
  parkingCost: number;
  serviceCost: number;
  refundAmount?: number;
  finalTotal: number;
}

export const PriceBreakdown = ({
  parkingCost,
  serviceCost,
  refundAmount = 0,
  finalTotal,
}: PriceBreakdownProps) => { const { t: translateUi } = useLanguage(); return (
  <Card style={styles.card}>
    <AppText variant="h3">{translateUi("Price breakdown")}</AppText>
    <View style={styles.row}>
      <AppText color={colors.light.text.secondary} style={styles.label} variant="body2">{translateUi("Parking")}</AppText>
      <AppText style={styles.amount} variant="body2">{formatCurrency(parkingCost)}</AppText>
    </View>
    <View style={styles.row}>
      <AppText color={colors.light.text.secondary} style={styles.label} variant="body2">{translateUi("Services")}</AppText>
      <AppText style={styles.amount} variant="body2">{formatCurrency(serviceCost)}</AppText>
    </View>
    {refundAmount > 0 ? (
      <View style={styles.row}>
        <AppText color={colors.success.main} style={styles.label} variant="body2">{translateUi("Refund")}</AppText>
        <AppText color={colors.success.main} style={styles.amount} variant="body2">{formatCurrency(refundAmount)}</AppText>
      </View>
    ) : null}
    <View style={[styles.row, styles.total]}>
      <AppText style={styles.label} variant="h3">{translateUi("Total")}</AppText>
      <AppText color={colors.primary[500]} style={styles.amount} variant="h3">{formatCurrency(finalTotal)}</AppText>
    </View>
  </Card>
); };

const styles = StyleSheet.create({
  card: {
    gap: spacing.lg,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  total: {
    borderTopColor: colors.light.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: spacing.lg,
  },
  label: { flexGrow: 1, flexBasis: 80 },
  amount: { flexShrink: 1, maxWidth: '100%', textAlign: 'right', fontVariant: ['tabular-nums'] },
});
