import { AnimatedBackground, BrandHeader, AuthCard, PrimaryButton, authStyles } from './AuthVisuals';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import type { ComponentProps, ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StatusBar, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS } from '@/constants/theme';

export function AuthRecoveryLayout({ children, icon, title, description, onBack, showBackButton = true }: {
  children: ReactNode; icon: ComponentProps<typeof Ionicons>['name']; title: string; description: string; onBack: () => void; showBackButton?: boolean;
}) {
  return <SafeAreaView style={recoveryStyles.safe}>
    <StatusBar barStyle="light-content" />
    <LinearGradient colors={[COLORS.background, COLORS.surface, COLORS.goldTint]} locations={[0, 0.62, 1]} style={StyleSheet.absoluteFill} />
    <AnimatedBackground />
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={authStyles.scroll} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" showsVerticalScrollIndicator={false}>
        <View style={recoveryStyles.content}>
          <View>
            <BrandHeader />
            {showBackButton ? <Pressable accessibilityRole="button" accessibilityLabel="Back to sign in" onPress={onBack} style={recoveryStyles.back}><Ionicons name="arrow-back" size={21} color={COLORS.textPrimary} /></Pressable> : null}
          </View>
          <AuthCard>
          <View style={recoveryStyles.sectionTag}><Ionicons name={icon} size={16} color={COLORS.gold} /><Text style={recoveryStyles.eyebrow}>ACCOUNT SECURITY</Text></View>
          <Text style={authStyles.cardTitle}>{title}</Text>
          <Text style={[authStyles.cardSub, { marginBottom: 24 }]}>{description}</Text>
          {children}
          <Pressable accessibilityRole="button" onPress={onBack} style={recoveryStyles.returnLink}><Ionicons name="arrow-back" size={16} color={COLORS.textSecondary} /><Text style={recoveryStyles.returnText}>Back to sign in</Text></Pressable>
          </AuthCard>
          <Text style={authStyles.footer}>2026 VALO Parking - All rights reserved</Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}

export function RecoveryButton({ title, onPress, loading, disabled }: { title: string; onPress: () => void; loading?: boolean; disabled?: boolean }) {
  return <View style={{ marginTop: 24 }}><PrimaryButton title={title} onPress={onPress} loading={loading} disabled={disabled} /></View>;
}

export function RecoveryError({ message }: { message: string }) {
  if (!message) return null;
  return <View accessibilityLiveRegion="polite" style={recoveryStyles.error}><Ionicons name="alert-circle-outline" size={18} color={COLORS.error} /><Text style={recoveryStyles.errorText}>{message}</Text></View>;
}

export const recoveryStyles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.background },
  content: { width: '100%' },
  back: { position: 'absolute', left: 0, top: 0, width: 44, height: 44, borderRadius: 14, backgroundColor: COLORS.surfaceElevated, alignItems: 'center', justifyContent: 'center', zIndex: 1 },
  sectionTag: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingBottom: 14, marginBottom: 18, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  eyebrow: { color: COLORS.gold, fontSize: 11, fontWeight: '700', letterSpacing: 1.5 },
  label: { color: COLORS.textPrimary, fontSize: 14, fontWeight: '600', marginBottom: 10 },
  inputWrap: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, backgroundColor: COLORS.surfaceElevated, borderWidth: 1, borderColor: COLORS.border, borderRadius: 14 },
  input: { flex: 1, minWidth: 0, color: COLORS.textPrimary, minHeight: 56, fontSize: 16, paddingVertical: 14 },
  hint: { color: COLORS.textMuted, fontSize: 13, lineHeight: 20, marginTop: 12 },
  returnLink: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 24 },
  returnText: { color: COLORS.textSecondary, fontSize: 14, fontWeight: '500' },
  error: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 14, backgroundColor: COLORS.errorTint, borderRadius: 12, marginTop: 16 },
  errorText: { flex: 1, color: COLORS.error, fontSize: 13, lineHeight: 20 },
});
