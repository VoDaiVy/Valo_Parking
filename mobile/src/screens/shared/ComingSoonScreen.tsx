import { useLanguage } from '@/contexts/LanguageContext';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { ScrollView, StatusBar, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { COLORS, RADIUS, SPACE, SPACING } from '../../constants/theme';
import { typography } from '@/theme';

export default function ComingSoonScreen() {
  const { t: translateUi } = useLanguage();
  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" />
      <LinearGradient
        colors={[COLORS.background, COLORS.surface, COLORS.goldTint]}
        locations={[0, 0.6, 1]}
        style={StyleSheet.absoluteFill}
      />
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.iconRing}>
          <Ionicons name="construct-outline" size={40} color={COLORS.gold} />
        </View>
        <Text accessibilityRole="header" style={styles.title}>{translateUi("Coming soon")}</Text>
        <Text style={styles.subtitle}>
          {" "}{translateUi("This feature is in development and will be available in a future release.")}{" "}</Text>
        <View style={styles.badge}>
          <Ionicons name="flash-outline" size={12} color={COLORS.gold} />
          <Text style={styles.badgeText}>{translateUi("Phase 2 — In development")}</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.background },
  container: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.xl,
  },
  iconRing: {
    width: SPACE[64] + SPACE[16],
    height: SPACE[64] + SPACE[16],
    borderRadius: RADIUS.xl,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.goldTint,
    marginBottom: SPACING.lg,
  },
  title: {
    ...typography.h2,
    textAlign: 'center',
    color: COLORS.textPrimary,
    marginBottom: SPACING.sm,
  },
  subtitle: {
    ...typography.body1,
    color: COLORS.textSecondary,
    textAlign: 'center',
    maxWidth: 360,
    marginBottom: SPACING.lg,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE[8],
    maxWidth: '100%',
    backgroundColor: COLORS.goldTint,
    borderRadius: RADIUS.round,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
  },
  badgeText: { ...typography.caption, color: COLORS.gold, fontWeight: '600', flexShrink: 1 },
});
