import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView, StyleSheet, Text, View } from 'react-native';

import { WorkflowButton } from '@/components/common/WorkflowUI';
import { COLORS, RADIUS, SPACING } from '@/constants/theme';
import { useAuth } from '@/hooks/useAuth';

export function UnsupportedRoleScreen() {
  const { logout } = useAuth();

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.content}>
        <View style={styles.iconWrap}>
          <Ionicons name="desktop-outline" size={36} color={COLORS.gold} />
        </View>
        <Text style={styles.title}>Mobile access unavailable</Text>
        <Text style={styles.body}>
          Admin accounts use the VALO web admin panel. Sign out here and continue from the admin dashboard.
        </Text>
        <WorkflowButton title="Sign out" onPress={() => void logout()} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { alignItems: 'center', backgroundColor: COLORS.background, flex: 1, justifyContent: 'center', padding: SPACING.lg },
  content: { alignItems: 'center', backgroundColor: COLORS.surface, borderColor: COLORS.border, borderRadius: RADIUS.xl, borderWidth: 1, gap: SPACING.md, maxWidth: 420, padding: SPACING.xl, width: '100%' },
  iconWrap: { alignItems: 'center', backgroundColor: 'rgba(226,186,75,0.12)', borderRadius: RADIUS.round, height: 76, justifyContent: 'center', width: 76 },
  title: { color: COLORS.textPrimary, fontSize: 22, fontWeight: '800', textAlign: 'center' },
  body: { color: COLORS.textSecondary, fontSize: 14, lineHeight: 22, textAlign: 'center' },
});
