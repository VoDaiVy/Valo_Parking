import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GateControlPanel } from '@/components/staff/dashboard/GateControlPanel';
import { COLORS, FONT_SIZES, SPACING } from '@/constants/theme';

export default function StaffGateControlScreen() {
  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>STAFF OPERATIONS</Text>
        <Text style={styles.title}>Gate Control</Text>
        <Text style={styles.subtitle}>Monitor and operate the entry and exit barriers.</Text>
      </View>
      <View style={styles.content}>
        <GateControlPanel />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: SPACING.lg },
  eyebrow: { color: COLORS.gold, fontSize: FONT_SIZES.xs, fontWeight: '900', letterSpacing: 1.5 },
  header: { gap: SPACING.xs, paddingHorizontal: SPACING.lg, paddingVertical: SPACING.lg },
  safe: { backgroundColor: COLORS.background, flex: 1 },
  subtitle: { color: COLORS.textSecondary, fontSize: FONT_SIZES.sm },
  title: { color: COLORS.textPrimary, fontSize: FONT_SIZES.xxl, fontWeight: '900' },
});
