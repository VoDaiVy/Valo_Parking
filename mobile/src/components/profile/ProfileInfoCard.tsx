import { useLanguage } from '@/contexts/LanguageContext';
import { StyleSheet, View } from 'react-native';

import { AppText, Card } from '@/components/common';
import { colors, spacing } from '@/theme';

export const ProfileInfoCard = ({ rows }: { rows: Array<{ label: string; value?: string | null }> }) => { const { t: translateUi } = useLanguage(); return (
  <Card style={styles.card}>
    {rows.map((row) => (
      <View key={row.label} style={styles.row}>
        <AppText color={colors.light.text.secondary} style={styles.label} variant="body2">{translateUi(row.label)}</AppText>
        <AppText style={styles.value} variant="body2">{row.value || translateUi("Not set")}</AppText>
      </View>
    ))}
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
    gap: spacing.md,
  },
  label: { flex: 1, minWidth: 0 },
  value: { flex: 1.4, minWidth: 0, textAlign: 'right', fontWeight: '500' },
});

