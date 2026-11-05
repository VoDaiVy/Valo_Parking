import { useLanguage } from '@/contexts/LanguageContext';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { ReactNode } from 'react';
import { useState } from 'react';
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

import { RegistrationOtpModal } from '@/components/auth/RegistrationOtpModal';
import { COLORS, FONT_SIZES, RADIUS, SPACING } from '@/constants/theme';
import { typography } from '@/theme';
import { useAuth } from '@/hooks/useAuth';
import type { AuthStackParamList } from '@/navigation/types';
import { authService } from '@/services/api/auth';
import { isValidEmail, isValidPassword } from '@/utils/validation';

type Props = NativeStackScreenProps<AuthStackParamList, 'Register'>;
type KeyboardType = 'default' | 'email-address' | 'phone-pad';

const LogoImg = require('../../../assets/logo.png') as number;

function Field({
  icon,
  placeholder,
  value,
  onChangeText,
  secureTextEntry,
  keyboardType = 'default',
  autoCapitalize = 'sentences',
}: {
  icon: ReactNode;
  placeholder: string;
  value: string;
  onChangeText: (value: string) => void;
  secureTextEntry?: boolean;
  keyboardType?: KeyboardType;
  autoCapitalize?: 'none' | 'sentences';
}) {
  const [focused, setFocused] = useState(false);

  return (
    <View style={[styles.fieldWrap, focused ? styles.fieldFocused : styles.fieldDefault]}>
      <View style={styles.fieldIcon}>{icon}</View>
      <TextInput
        autoCapitalize={autoCapitalize}
        keyboardType={keyboardType}
        placeholder={placeholder}
        placeholderTextColor={COLORS.textMuted}
        secureTextEntry={secureTextEntry}
        selectionColor={COLORS.gold}
        style={styles.fieldInput}
        value={value}
        onBlur={() => setFocused(false)}
        onChangeText={onChangeText}
        onFocus={() => setFocused(true)}
      />
    </View>
  );
}

export const RegisterScreen = ({ navigation }: Props) => {
  const { t: translateUi } = useLanguage();
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [otpOpen, setOtpOpen] = useState(false);
  const [otpError, setOtpError] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [resending, setResending] = useState(false);

  const handleSubmit = async () => {
    const normalizedName = username.trim();
    const normalizedEmail = email.trim().toLowerCase();
    const normalizedPhone = phone.trim();
    const normalizedUsername = normalizedName
      .replace(/\s+/g, '_')
      .replace(/[^a-zA-Z0-9_]/g, '')
      .slice(0, 30);

    setError('');

    if (!normalizedName) {
      setError('Please enter your name.');
      return;
    }

    if (!normalizedUsername) {
      setError('Please use letters or numbers in your name.');
      return;
    }

    if (!isValidEmail(normalizedEmail)) {
      setError('Please enter a valid email.');
      return;
    }

    if (!/^[+()\-\s\d]{7,20}$/.test(normalizedPhone)) {
      setError('Please enter a valid phone number.');
      return;
    }

    if (!isValidPassword(password)) {
      setError('Password must be at least 8 characters.');
      return;
    }

    setIsLoading(true);
    try {
      await authService.register({
        username: normalizedUsername,
        name: normalizedName,
        email: normalizedEmail,
        phone: normalizedPhone,
        password,
        confirmPassword: password,
        role: 'customer',
      });
      await authService.sendOTP({ email: normalizedEmail });
      setOtpError('');
      setOtpOpen(true);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Registration failed.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerify = async (otp: string) => {
    setVerifying(true);
    setOtpError('');
    try {
      const normalizedEmail = email.trim().toLowerCase();
      await authService.verifyOTP({ email: normalizedEmail, otp });
      await login({ email: normalizedEmail, password });
      setOtpOpen(false);
    } catch (verifyError) {
      setOtpError(verifyError instanceof Error ? verifyError.message : 'Invalid verification code.');
    } finally {
      setVerifying(false);
    }
  };

  const handleResend = async () => {
    setResending(true);
    setOtpError('');
    try {
      await authService.sendOTP({ email: email.trim().toLowerCase() });
    } catch (resendError) {
      setOtpError(resendError instanceof Error ? resendError.message : 'Unable to resend verification code.');
    } finally {
      setResending(false);
    }
  };

  return (
    <SafeAreaView edges={['top', 'bottom']} style={styles.safe}>
      <StatusBar barStyle="light-content" />
      <LinearGradient
        colors={[COLORS.background, COLORS.surface, COLORS.goldTint]}
        locations={[0, 0.6, 1]}
        style={StyleSheet.absoluteFill}
      />
      <View pointerEvents="none" style={styles.cornerGlow} />

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.kav}>
        <ScrollView
          bounces={false}
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.hero}>
            <View style={styles.logoGlow}>
              <Image resizeMode="contain" source={LogoImg} style={styles.logoImg} />
            </View>
            <Text style={styles.brandName}>VALO</Text>
            <Text style={styles.brandSub}>PARKING</Text>
          </View>

          <View style={styles.card}>
            <LinearGradient
              colors={[COLORS.gold, 'transparent']}
              end={{ x: 1, y: 0 }}
              start={{ x: 0, y: 0 }}
              style={styles.cardTopLine}
            />
            <Text style={styles.cardTitle}>{translateUi("Create account")}</Text>
            <Text style={styles.cardSub}>{translateUi("Book parking and manage your VALO wallet")}</Text>

            <Field
              icon={<Ionicons color={COLORS.textMuted} name="person-outline" size={18} />}
              placeholder={translateUi("Full name")}
              value={username}
              onChangeText={setUsername}
            />
            <Field
              autoCapitalize="none"
              icon={<Ionicons color={COLORS.textMuted} name="mail-outline" size={18} />}
              keyboardType="email-address"
              placeholder="Email"
              value={email}
              onChangeText={setEmail}
            />
            <Field
              icon={<Ionicons color={COLORS.textMuted} name="call-outline" size={18} />}
              keyboardType="phone-pad"
              placeholder={translateUi("Phone number")}
              value={phone}
              onChangeText={setPhone}
            />
            <Field
              autoCapitalize="none"
              icon={<Ionicons color={COLORS.textMuted} name="lock-closed-outline" size={18} />}
              placeholder={translateUi("Password")}
              secureTextEntry
              value={password}
              onChangeText={setPassword}
            />

            {error ? (
              <View style={styles.errorBox}>
                <Ionicons color={COLORS.error} name="warning-outline" size={16} />
                <Text style={styles.errorText}>{translateUi(error)}</Text>
              </View>
            ) : null}

            <TouchableOpacity
              activeOpacity={0.85}
              disabled={isLoading}
              style={[styles.submitBtn, isLoading && styles.disabled]}
              onPress={handleSubmit}
            >
              <LinearGradient
                colors={[COLORS.goldLight, COLORS.gold, COLORS.goldDark]}
                end={{ x: 1, y: 0 }}
                start={{ x: 0, y: 0 }}
                style={styles.submitGrad}
              >
                {isLoading ? (
                  <ActivityIndicator color={COLORS.textInverse} size="small" />
                ) : (
                  <>
                    <Text style={styles.submitText}>{translateUi("Create account")}</Text>
                    <Ionicons color={COLORS.textInverse} name="arrow-forward" size={18} />
                  </>
                )}
              </LinearGradient>
            </TouchableOpacity>

            <Pressable
              style={({ pressed }) => [styles.loginRow, pressed && styles.pressed]}
              onPress={() => navigation.goBack()}
            >
              <Text style={styles.loginText}>{translateUi("Already have an account?")}{" "}</Text>
              <Text style={[styles.loginText, styles.loginLink]}>{translateUi("Sign in")}</Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      <RegistrationOtpModal
        email={email.trim().toLowerCase()}
        error={otpError}
        resending={resending}
        verifying={verifying}
        visible={otpOpen}
        onCancel={() => setOtpOpen(false)}
        onResend={handleResend}
        onVerify={handleVerify}
      />
    </SafeAreaView>
  );
};

export default RegisterScreen;

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.background },
  kav: { flex: 1 },
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.xl,
    width: '100%',
    maxWidth: 480,
    alignSelf: 'center',
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
    backgroundColor: COLORS.goldTint,
    borderColor: COLORS.border,
    borderRadius: 48,
    borderWidth: 1,
    height: 96,
    justifyContent: 'center',
    marginBottom: SPACING.sm,
    width: 96,
  },
  logoImg: { height: 68, width: 68 },
  brandName: {
    ...typography.h1,
    color: COLORS.gold,
  },
  brandSub: {
    color: COLORS.textSecondary,
    fontSize: FONT_SIZES.sm,
    fontWeight: '600',
    letterSpacing: 5,
    marginTop: -4,
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
    ...typography.h2,
    color: COLORS.textPrimary,
    marginBottom: 4,
    marginTop: SPACING.xs,
  },
  cardSub: {
    ...typography.body2,
    color: COLORS.textSecondary,
    fontSize: FONT_SIZES.sm,
    marginBottom: SPACING.lg,
  },
  fieldWrap: {
    alignItems: 'center',
    borderRadius: RADIUS.md,
    borderWidth: 1,
    flexDirection: 'row',
    minHeight: 52,
    marginBottom: SPACING.md,
    paddingHorizontal: SPACING.sm,
  },
  fieldDefault: {
    backgroundColor: COLORS.surfaceElevated,
    borderColor: COLORS.border,
  },
  fieldFocused: {
    backgroundColor: COLORS.surfaceElevated,
    borderColor: COLORS.gold,
  },
  fieldIcon: {
    alignItems: 'center',
    width: 32,
  },
  fieldInput: {
    ...typography.body1,
    color: COLORS.textPrimary,
    flex: 1,
    fontSize: FONT_SIZES.md,
    paddingVertical: 12,
    minWidth: 0,
  },
  errorBox: {
    alignItems: 'center',
    backgroundColor: COLORS.errorTint,
    borderColor: COLORS.error,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: SPACING.xs,
    marginBottom: SPACING.md,
    padding: SPACING.sm,
  },
  errorText: {
    color: COLORS.error,
    flex: 1,
    fontSize: FONT_SIZES.sm,
  },
  submitBtn: {
    borderRadius: RADIUS.lg,
    marginTop: SPACING.xs,
    overflow: 'hidden',
  },
  submitGrad: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: SPACING.sm,
    justifyContent: 'center',
    minHeight: 52,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  submitText: {
    ...typography.button,
    color: COLORS.textInverse,
    fontSize: FONT_SIZES.md,
    flexShrink: 1,
    textAlign: 'center',
  },
  disabled: { opacity: 0.6 },
  pressed: { opacity: 0.88, transform: [{ scale: 0.98 }] },
  loginRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: SPACING.md,
    paddingVertical: SPACING.sm,
    minHeight: 44,
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  loginText: {
    color: COLORS.textSecondary,
    fontSize: FONT_SIZES.sm,
  },
  loginLink: {
    color: COLORS.gold,
    fontWeight: '700',
  },
});
