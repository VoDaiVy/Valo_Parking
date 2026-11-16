import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useRef, useState, type ElementRef } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { AuthRecoveryLayout, RecoveryButton, RecoveryError, recoveryStyles } from '@/components/auth/AuthRecoveryLayout';
import { COLORS } from '@/constants/theme';
import { useToast } from '@/hooks/useToast';
import type { AuthStackParamList } from '@/navigation/types';
import { authService } from '@/services/api/auth';
import { isValidOtp } from '@/utils/validation';

type Props = NativeStackScreenProps<AuthStackParamList, 'VerifyOTP'>;

export const VerifyOTPScreen = ({ navigation, route }: Props) => {
  const toast = useToast();
  const [cooldown, setCooldown] = useState(0);
  const [notice, setNotice] = useState('');
  const inputRef = useRef<ElementRef<typeof TextInput>>(null);
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState('');
  const isRegisterVerification = route.params.purpose === 'register';

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const handleSubmit = async () => {
    if (loading || resending) return;
    if (!isValidOtp(otp)) {
      setError('Enter the 6-digit OTP code.');
      return;
    }

    setLoading(true);
    setError('');
    try {
      if (isRegisterVerification) {
        await authService.verifyOTP({ email: route.params.email, otp });
        toast.showSuccess('Email verified', 'Please login to continue.');
        navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
      } else {
        await authService.verifyResetOTP({ email: route.params.email, otp });
        navigation.navigate('ResetPassword', { email: route.params.email, otp });
      }
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'OTP verification failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (resending || loading || cooldown > 0) return;
    setResending(true);
    setError('');
    try {
      if (isRegisterVerification) {
        await authService.sendOTP({ email: route.params.email });
      } else {
        await authService.forgotPassword({ email: route.params.email });
      }
      setNotice('A new code has been sent. Check your inbox and spam folder.');
      setOtp('');
      setCooldown(60);
      inputRef.current?.focus();
    } catch (resendError) {
      setError(resendError instanceof Error ? resendError.message : 'Unable to resend OTP.');
    } finally {
      setResending(false);
    }
  };

  const backToLogin = () => navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
  return <AuthRecoveryLayout showBackButton={false} icon="mail-open-outline" title={isRegisterVerification ? 'Verify your email' : 'Check your inbox'} description={isRegisterVerification ? 'One last step to get started. Enter the 6-digit code sent to your email.' : 'Enter the 6-digit code we sent you to continue resetting your password.'} onBack={backToLogin}>
    <View style={styles.emailBadge}><Text selectable style={styles.email}>{route.params.email}</Text></View>
    <Text style={recoveryStyles.label}>Verification code</Text>
    <View style={styles.codeWrap}>
      <View pointerEvents="none" accessible={false} style={styles.digits}>
        {Array.from({ length: 6 }, (_, index) => <View key={index} style={[styles.cell, index === otp.length && styles.activeCell, Boolean(error) && styles.errorCell]}><Text style={styles.digit}>{otp[index] || ''}</Text></View>)}
      </View>
      <TextInput ref={inputRef} accessibilityLabel="6-digit verification code" value={otp} onChangeText={(value) => { setOtp(value.replace(/\D/g, '').slice(0, 6)); setError(''); setNotice(''); }} editable={!loading && !resending} keyboardType="number-pad" textContentType="oneTimeCode" autoComplete="one-time-code" maxLength={6} caretHidden style={styles.codeInput} selectionColor="transparent" onSubmitEditing={handleSubmit} />
    </View>
    <Text style={recoveryStyles.hint}>Keep this code private. Check your spam folder if it hasn't arrived.</Text>
    <RecoveryError message={error} />
    {notice ? <Text accessibilityLiveRegion="polite" style={styles.notice}>{notice}</Text> : null}
    <RecoveryButton title={isRegisterVerification ? 'Verify email' : 'Verify code'} loading={loading} disabled={otp.length !== 6 || resending} onPress={handleSubmit} />
    <View style={styles.resendRow}><Text style={styles.resendHint}>Didn't receive a code?</Text>
      <Pressable accessibilityRole="button" disabled={resending || loading || cooldown > 0} onPress={handleResend} style={styles.resendButton}>
        {resending ? <ActivityIndicator color={COLORS.gold} size="small" /> : <Text style={[styles.resendText, cooldown > 0 && { color: COLORS.textMuted }]}>{cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}</Text>}
      </Pressable>
    </View>
  </AuthRecoveryLayout>;
};

const styles = StyleSheet.create({
  emailBadge: { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 12, marginBottom: 28 },
  email: { color: COLORS.textPrimary, fontSize: 14, lineHeight: 21 },
  codeWrap: { position: 'relative', minHeight: 58 },
  digits: { flexDirection: 'row', gap: 8 },
  cell: { flex: 1, minWidth: 0, height: 58, borderRadius: 12, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface, alignItems: 'center', justifyContent: 'center' },
  activeCell: { borderColor: COLORS.gold, backgroundColor: COLORS.goldTint },
  errorCell: { borderColor: COLORS.error },
  digit: { color: COLORS.textPrimary, fontSize: 24, fontWeight: '600', fontVariant: ['tabular-nums'] },
  codeInput: { ...StyleSheet.absoluteFill, color: 'transparent', fontSize: 24, backgroundColor: 'transparent' },
  notice: { color: COLORS.success, fontSize: 13, lineHeight: 20, marginTop: 16 },
  resendRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 4, flexWrap: 'wrap', marginTop: 12 },
  resendHint: { color: COLORS.textSecondary, fontSize: 13 },
  resendButton: { minHeight: 44, paddingHorizontal: 8, justifyContent: 'center' },
  resendText: { color: COLORS.gold, fontSize: 13, fontWeight: '700' },
});
