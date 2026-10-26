import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useState } from 'react';
import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { COLORS, FONT_SIZES, RADIUS, SPACING } from '@/constants/theme';
import { useAuth } from '@/hooks/useAuth';
import { useGoogleSignIn } from '@/hooks/useGoogleSignIn';
import { useAppAlert } from '@/contexts/AppAlertContext';


const LogoImg = require('../../../assets/logo.png') as number;

interface LoginScreenProps {
  navigation?: {
    navigate: (screen: string) => void;
  };
}

function GoogleIcon() {
  return (
    <View style={googleIconStyles.wrap}>
      <View style={[googleIconStyles.quad, { backgroundColor: '#4285F4' }]} />
      <View style={[googleIconStyles.quad, { backgroundColor: '#34A853' }]} />
      <View style={[googleIconStyles.quad, { backgroundColor: '#FBBC05' }]} />
      <View style={[googleIconStyles.quad, { backgroundColor: '#EA4335' }]} />
    </View>
  );
}

function Field({
  icon,
  placeholder,
  value,
  onChangeText,
  secureTextEntry,
  keyboardType,
  autoCapitalize,
  returnKeyType,
  onSubmitEditing,
  rightIcon,
  onRightIconPress,
}: {
  icon: ReactNode;
  placeholder: string;
  value: string;
  onChangeText: (value: string) => void;
  secureTextEntry?: boolean;
  keyboardType?: 'default' | 'email-address';
  autoCapitalize?: 'none' | 'sentences';
  returnKeyType?: 'next' | 'done';
  onSubmitEditing?: () => void;
  rightIcon?: ReactNode;
  onRightIconPress?: () => void;
}) {
  const [focused, setFocused] = useState(false);

  return (
    <View style={[styles.fieldWrap, focused ? styles.fieldFocused : styles.fieldDefault]}>
      <View style={styles.fieldIconLeft}>{icon}</View>
      <TextInput
        autoCapitalize={autoCapitalize ?? 'sentences'}
        keyboardType={keyboardType}
        placeholder={placeholder}
        placeholderTextColor={COLORS.textMuted}
        returnKeyType={returnKeyType}
        secureTextEntry={secureTextEntry}
        selectionColor={COLORS.gold}
        style={styles.fieldInput}
        value={value}
        onBlur={() => setFocused(false)}
        onChangeText={onChangeText}
        onFocus={() => setFocused(true)}
        onSubmitEditing={onSubmitEditing}
      />
      {rightIcon ? (
        <TouchableOpacity
          activeOpacity={0.7}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          style={styles.fieldIconRight}
          onPress={onRightIconPress}
        >
          {rightIcon}
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

export default function LoginScreen({ navigation }: LoginScreenProps) {
  const { login } = useAuth();
  const { alert } = useAppAlert();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordHidden, setPasswordHidden] = useState(true);
  const [loading, setLoading] = useState(false);
  const { loading: googleLoading, enabled: googleEnabled, signIn: promptGoogleLogin } = useGoogleSignIn();

  const handleLogin = async () => {
    const trimEmail = email.trim();
    const trimPass = password.trim();

    if (!trimEmail || !trimPass) {
      alert('Missing information', 'Please enter your email and password.');
      return;
    }

    setLoading(true);
    try {
      await login({ email: trimEmail, password: trimPass });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Sign-in failed. Please try again.';
      alert('Sign-in failed', message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView edges={['top', 'bottom']} style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor="#080808" />
      <LinearGradient
        colors={['#080808', '#111111', '#161208']}
        locations={[0, 0.6, 1]}
        style={StyleSheet.absoluteFill}
      />
      <View pointerEvents="none" style={styles.cornerGlow} />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.kav}
      >
        <ScrollView
          bounces={false}
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.hero}>
            <View style={styles.logoGlow}>
              <Image resizeMode="contain" source={LogoImg} style={styles.logoImg} />
            </View>
            <Text style={styles.brandName}>VALO</Text>
            <Text style={styles.brandSub}>PARKING</Text>
            <View style={styles.badge}>
              <Ionicons name="flash" size={11} color={COLORS.gold} />
              <Text style={styles.badgeText}>Smart Parking Platform</Text>
            </View>
          </View>

          <View style={styles.card}>
            <LinearGradient
              colors={[COLORS.gold, 'transparent']}
              end={{ x: 1, y: 0 }}
              start={{ x: 0, y: 0 }}
              style={styles.cardTopLine}
            />
            <Text style={styles.cardTitle}>Sign in</Text>
            <Text style={styles.cardSub}>Welcome back to VALO Parking</Text>

            <Field
              autoCapitalize="none"
              icon={<Ionicons name="mail-outline" size={18} color={COLORS.textMuted} />}
              keyboardType="email-address"
              placeholder="Your email"
              returnKeyType="next"
              value={email}
              onChangeText={setEmail}
            />

            <Field
              icon={<Ionicons name="lock-closed-outline" size={18} color={COLORS.textMuted} />}
              placeholder="Password"
              returnKeyType="done"
              rightIcon={
                <Ionicons
                  name={passwordHidden ? 'eye-off-outline' : 'eye-outline'}
                  size={18}
                  color={COLORS.textMuted}
                />
              }
              secureTextEntry={passwordHidden}
              value={password}
              onChangeText={setPassword}
              onRightIconPress={() => setPasswordHidden((value) => !value)}
              onSubmitEditing={handleLogin}
            />

            <Pressable
              style={({ pressed }) => [styles.forgotRow, pressed && styles.pressed]}
              onPress={() => navigation?.navigate('ForgotPassword')}
            >
              <Text style={styles.forgotText}>Forgot password?</Text>
            </Pressable>

            <TouchableOpacity
              activeOpacity={0.85}
              disabled={loading}
              style={[styles.loginBtn, loading && styles.disabled]}
              onPress={handleLogin}
            >
              <LinearGradient
                colors={[COLORS.goldLight, COLORS.gold, COLORS.goldDark]}
                end={{ x: 1, y: 0 }}
                start={{ x: 0, y: 0 }}
                style={styles.loginBtnGrad}
              >
                {loading ? (
                  <ActivityIndicator color={COLORS.textInverse} size="small" />
                ) : (
                  <>
                    <Text style={styles.loginBtnText}>Sign in</Text>
                    <Ionicons name="arrow-forward" size={18} color={COLORS.textInverse} />
                  </>
                )}
              </LinearGradient>
            </TouchableOpacity>

            <View style={styles.dividerRow}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>or continue with</Text>
              <View style={styles.dividerLine} />
            </View>

            <TouchableOpacity
              activeOpacity={0.85}
              disabled={!googleEnabled || googleLoading}
              style={[styles.googleBtn, (!googleEnabled || googleLoading) && styles.disabled]}
              onPress={promptGoogleLogin}
            >
              {googleLoading ? (
                <ActivityIndicator color="#444" size="small" />
              ) : (
                <>
                  <GoogleIcon />
                  <Text style={styles.googleBtnText}>Continue with Google</Text>
                </>
              )}
            </TouchableOpacity>

            <Pressable
              style={({ pressed }) => [styles.registerRow, pressed && styles.pressed]}
              onPress={() => navigation?.navigate('Register')}
            >
              <Text style={styles.registerText}>New to VALO? </Text>
              <Text style={[styles.registerText, styles.registerLink]}>Create account</Text>
            </Pressable>
          </View>

          <Text style={styles.footer}>2026 VALO Parking - All rights reserved</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const googleIconStyles = StyleSheet.create({
  wrap: {
    borderRadius: 10,
    flexDirection: 'row',
    flexWrap: 'wrap',
    height: 20,
    overflow: 'hidden',
    width: 20,
  },
  quad: { height: 10, width: 10 },
});

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#080808' },
  kav: { flex: 1 },
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.xl,
  },
  cornerGlow: {
    backgroundColor: COLORS.gold,
    borderRadius: 130,
    height: 260,
    opacity: 0.05,
    position: 'absolute',
    right: -80,
    top: -80,
    width: 260,
  },
  hero: { alignItems: 'center', marginBottom: SPACING.xl },
  logoGlow: {
    alignItems: 'center',
    backgroundColor: 'rgba(212,175,55,0.08)',
    borderColor: 'rgba(212,175,55,0.3)',
    borderRadius: 54,
    borderWidth: 1.5,
    height: 108,
    justifyContent: 'center',
    marginBottom: SPACING.sm,
    shadowColor: COLORS.gold,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.55,
    shadowRadius: 22,
    width: 108,
  },
  logoImg: { height: 78, width: 78 },
  brandName: {
    color: COLORS.gold,
    fontSize: 38,
    fontWeight: '900',
    letterSpacing: 10,
    marginTop: SPACING.xs,
  },
  brandSub: {
    color: COLORS.textSecondary,
    fontSize: FONT_SIZES.sm,
    fontWeight: '600',
    letterSpacing: 6,
    marginTop: -4,
  },
  badge: {
    alignItems: 'center',
    backgroundColor: 'rgba(212,175,55,0.1)',
    borderColor: 'rgba(212,175,55,0.25)',
    borderRadius: RADIUS.round,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 5,
    marginTop: SPACING.sm,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  badgeText: {
    color: COLORS.gold,
    fontSize: FONT_SIZES.xs,
    fontWeight: '700',
  },
  card: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderRadius: RADIUS.xl,
    borderWidth: 1,
    overflow: 'hidden',
    padding: SPACING.lg,
  },
  cardTopLine: {
    height: 2,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  cardTitle: {
    color: COLORS.textPrimary,
    fontSize: FONT_SIZES.xxl,
    fontWeight: '800',
    marginBottom: 4,
    marginTop: SPACING.xs,
  },
  cardSub: {
    color: COLORS.textSecondary,
    fontSize: FONT_SIZES.sm,
    marginBottom: SPACING.lg,
  },
  fieldWrap: {
    alignItems: 'center',
    borderRadius: RADIUS.lg,
    borderWidth: 1.5,
    flexDirection: 'row',
    height: 52,
    marginBottom: SPACING.sm,
    paddingHorizontal: SPACING.sm,
  },
  fieldDefault: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderColor: COLORS.border,
  },
  fieldFocused: {
    backgroundColor: 'rgba(212,175,55,0.06)',
    borderColor: 'rgba(212,175,55,0.5)',
  },
  fieldIconLeft: { alignItems: 'center', width: 32 },
  fieldIconRight: { alignItems: 'center', width: 32 },
  fieldInput: {
    color: COLORS.textPrimary,
    flex: 1,
    fontSize: FONT_SIZES.md,
    paddingVertical: 0,
  },
  forgotRow: {
    alignSelf: 'flex-end',
    marginBottom: SPACING.md,
    marginTop: 2,
  },
  forgotText: {
    color: COLORS.gold,
    fontSize: FONT_SIZES.sm,
    fontWeight: '600',
  },
  loginBtn: { borderRadius: RADIUS.lg, marginTop: 4, overflow: 'hidden' },
  loginBtnGrad: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: SPACING.sm,
    justifyContent: 'center',
    minHeight: 52,
  },
  loginBtnText: {
    color: COLORS.textInverse,
    fontSize: FONT_SIZES.md,
    fontWeight: '800',
  },
  dividerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    marginVertical: SPACING.md,
  },
  dividerLine: { backgroundColor: COLORS.border, flex: 1, height: 1 },
  dividerText: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZES.xs,
    marginHorizontal: SPACING.sm,
  },
  googleBtn: {
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderColor: '#e0e0e0',
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'center',
    marginBottom: SPACING.md,
    minHeight: 50,
  },
  googleBtnText: {
    color: '#3c4043',
    fontSize: FONT_SIZES.md,
    fontWeight: '600',
  },
  registerRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    paddingVertical: 4,
  },
  registerText: {
    color: COLORS.textSecondary,
    fontSize: FONT_SIZES.sm,
  },
  registerLink: {
    color: COLORS.gold,
    fontWeight: '700',
  },
  footer: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZES.xs,
    marginTop: SPACING.xl,
    opacity: 0.5,
    textAlign: 'center',
  },
  disabled: { opacity: 0.6 },
  pressed: { opacity: 0.65 },
});
