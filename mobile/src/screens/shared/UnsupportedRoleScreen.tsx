import { useLanguage } from '@/contexts/LanguageContext';
import { Ionicons } from '@expo/vector-icons';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { WorkflowButton } from '@/components/common/WorkflowUI';
import { COLORS, RADIUS, SPACE, SPACING } from '@/constants/theme';
import { typography } from '@/theme';
import { useAuth } from '@/hooks/useAuth';

export function UnsupportedRoleScreen() {
  const { t: translateUi } = useLanguage();
  const { logout } = useAuth();

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
      <View style={styles.content}>
        <View style={styles.iconWrap}>
          <Ionicons name="desktop-outline" size={36} color={COLORS.gold} />
        </View>
        <Text accessibilityRole="header" style={styles.title}>{translateUi("Mobile access unavailable")}</Text>
        <Text style={styles.body}>
          {" "}{translateUi("Admin accounts use the VALO web admin panel. Sign out here and continue from the admin dashboard.")}{" "}</Text>
        <WorkflowButton title={translateUi("Sign out")} onPress={() => void logout()} />
      </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { backgroundColor: COLORS.background, flex: 1 },
  scrollContent: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: SPACING.lg },
  content: { alignItems: 'center', backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, gap: SPACING.md, maxWidth: 420, padding: SPACING.lg, width: '100%' },
  iconWrap: { alignItems: 'center', backgroundColor: COLORS.goldTint, borderRadius: RADIUS.xl, height: SPACE[64], justifyContent: 'center', width: SPACE[64] },
  title: { ...typography.h2, color: COLORS.textPrimary, textAlign: 'center' },
  body: { ...typography.body1, color: COLORS.textSecondary, textAlign: 'center' },
});
