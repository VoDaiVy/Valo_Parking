import { useLanguage } from '@/contexts/LanguageContext';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { colors, spacing } from '@/theme';
import { CONTROL, RADIUS, SPACE } from '@/constants/theme';

export const LoadingSpinner = () => { const { t: translateUi } = useLanguage(); return (
  <View accessibilityLabel={translateUi("Loading")} accessibilityRole="progressbar" accessibilityState={{ busy: true }} style={styles.container}>
    <View style={styles.indicator}>
      <ActivityIndicator color={colors.primary[500]} size="small" />
    </View>
  </View>
); };

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    minHeight: SPACE[64] + SPACE[32],
  },
  indicator: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary[50],
    borderRadius: RADIUS.lg,
    width: CONTROL.minHeight,
    height: CONTROL.minHeight,
  },
});
