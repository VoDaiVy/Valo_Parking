import { useLanguage } from '@/contexts/LanguageContext';
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState, type ElementRef } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { COLORS, CONTROL, MOTION, RADIUS, SPACE, SPACING } from '@/constants/theme';
import { typography } from '@/theme';

type RegistrationOtpModalProps = {
  email: string;
  visible: boolean;
  verifying: boolean;
  resending: boolean;
  error: string;
  onCancel: () => void;
  onVerify: (otp: string) => void;
  onResend: () => void;
};

export const RegistrationOtpModal = ({
  email,
  visible,
  verifying,
  resending,
  error,
  onCancel,
  onVerify,
  onResend,
}: RegistrationOtpModalProps) => {
  const { t: translateUi } = useLanguage();
  const [otp, setOtp] = useState('');
  const [cooldown, setCooldown] = useState(0);
  const inputRefs = useRef<Array<ElementRef<typeof TextInput> | null>>([]);

  useEffect(() => {
    if (!visible) {
      setOtp('');
      setCooldown(0);
      return;
    }

    const timer = cooldown > 0 ? setInterval(() => setCooldown((value) => value - 1), 1000) : undefined;
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [cooldown, visible]);

  useEffect(() => {
    if (visible) {
      const focusTimer = setTimeout(() => inputRefs.current[0]?.focus(), 250);
      return () => clearTimeout(focusTimer);
    }

    return undefined;
  }, [visible]);

  const updateOtp = (index: number, value: string) => {
    const digits = value.replace(/\D/g, '');
    const next = otp.split('');

    if (digits.length > 1) {
      digits.slice(0, 6).split('').forEach((digit, offset) => {
        next[index + offset] = digit;
      });
      const nextIndex = Math.min(index + digits.length, 5);
      setOtp(next.slice(0, 6).join(''));
      inputRefs.current[nextIndex]?.focus();
      return;
    }

    next[index] = digits;
    setOtp(next.slice(0, 6).join(''));
    if (digits && index < 5) inputRefs.current[index + 1]?.focus();
  };

  const handleKeyPress = (index: number, key: string) => {
    if (key === 'Backspace' && !otp[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handleResend = () => {
    if (cooldown > 0 || resending) return;
    setOtp('');
    setCooldown(60);
    onResend();
  };

  const handleCancel = () => {
    Keyboard.dismiss();
    onCancel();
  };

  return (
    <Modal animationType="fade" transparent visible={visible} onRequestClose={handleCancel}>
      <SafeAreaView style={styles.overlay}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.keyboard}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.card}>
          <View style={styles.iconCircle}>
            <Ionicons color={COLORS.textInverse} name="mail-outline" size={28} />
          </View>
          <Text style={styles.title}>{translateUi("Verify your email")}</Text>
          <Text style={styles.description}>
            {" "}{translateUi("We sent a 6-digit verification code to")}{" "}<Text style={styles.email}>{email}</Text>{translateUi(". Enter it below to activate your VALO account.")}{" "}</Text>

          <View style={styles.otpRow}>
            {Array.from({ length: 6 }, (_, index) => (
              <TextInput
                key={index}
                accessibilityLabel={`Verification digit ${index + 1}`}
                ref={(ref) => { inputRefs.current[index] = ref; }}
                autoComplete="one-time-code"
                blurOnSubmit={false}
                keyboardType="number-pad"
                maxLength={index === 0 ? 6 : 1}
                selectionColor={COLORS.gold}
                style={[styles.otpInput, index === 2 && styles.otpGap]}
                value={otp[index] || ''}
                onChangeText={(value) => updateOtp(index, value)}
                onKeyPress={({ nativeEvent }) => handleKeyPress(index, nativeEvent.key)}
              />
            ))}
          </View>

          {error ? <Text style={styles.error}>{translateUi(error)}</Text> : null}

          <Text style={styles.resendText}>{translateUi("Didn't get the code?")}</Text>
          <Pressable accessibilityRole="button" disabled={cooldown > 0 || resending} style={({ pressed }) => [styles.resendButton, pressed && styles.pressed]} onPress={handleResend}>
            <Text style={[styles.resendLink, (cooldown > 0 || resending) && styles.disabledText]}>
              {resending ? translateUi("Sending...") : cooldown > 0 ? `Resend code in ${cooldown}s` : translateUi("Resend code")}
            </Text>
          </Pressable>

          <Pressable
            disabled={otp.length !== 6 || verifying}
            accessibilityRole="button"
            accessibilityState={{ disabled: otp.length !== 6 || verifying, busy: verifying }}
            style={({ pressed }) => [styles.verifyButton, (otp.length !== 6 || verifying) && styles.buttonDisabled, pressed && styles.pressed]}
            onPress={() => onVerify(otp)}
          >
            {verifying ? <ActivityIndicator color={COLORS.textInverse} /> : <Text style={styles.verifyText}>{translateUi("Verify & continue")}</Text>}
          </Pressable>
          <Pressable accessibilityRole="button" disabled={verifying} style={({ pressed }) => [styles.cancelButton, pressed && styles.pressed]} onPress={handleCancel}>
            <Text style={styles.cancelText}>{translateUi("Cancel")}</Text>
          </Pressable>
        </View>
        </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: { backgroundColor: 'rgba(0,0,0,0.78)', flex: 1 },
  keyboard: { flex: 1 },
  scroll: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: SPACE[16] },
  card: { alignItems: 'center', backgroundColor: COLORS.surface, borderRadius: RADIUS.xl, maxWidth: 420, padding: SPACE[16], width: '100%' },
  iconCircle: { alignItems: 'center', backgroundColor: COLORS.gold, borderRadius: RADIUS.md, height: 56, justifyContent: 'center', marginBottom: SPACING.md, width: 56 },
  title: { ...typography.h2, color: COLORS.textPrimary, textAlign: 'center', marginBottom: SPACING.sm },
  description: { ...typography.body2, color: COLORS.textSecondary, textAlign: 'center' },
  email: { color: COLORS.textPrimary, fontWeight: '700' },
  otpRow: { flexDirection: 'row', gap: SPACE[4], width: '100%', justifyContent: 'center', marginVertical: SPACING.lg },
  otpInput: { ...typography.h3, flex: 1, minWidth: 0, maxWidth: 48, backgroundColor: COLORS.surfaceElevated, borderColor: COLORS.borderLight, borderRadius: RADIUS.sm, borderWidth: 1, color: COLORS.textPrimary, minHeight: CONTROL.minHeight, textAlign: 'center', paddingVertical: SPACE[8], fontVariant: ['tabular-nums'] },
  otpGap: { marginRight: SPACE[4] },
  error: { ...typography.body2, color: COLORS.error, marginBottom: SPACING.sm, textAlign: 'center' },
  resendText: { ...typography.caption, color: COLORS.textSecondary, marginTop: SPACING.sm },
  resendLink: { ...typography.button, color: COLORS.gold, textAlign: 'center' },
  resendButton: { minHeight: CONTROL.minTouchSize, justifyContent: 'center', paddingHorizontal: SPACE[12] },
  pressed: { opacity: 0.88, transform: [{ scale: MOTION.pressedScale }] },
  disabledText: { color: COLORS.textMuted },
  verifyButton: { alignItems: 'center', backgroundColor: COLORS.gold, borderRadius: RADIUS.lg, justifyContent: 'center', marginTop: SPACING.lg, minHeight: 50, width: '100%' },
  buttonDisabled: { opacity: 0.55 },
  verifyText: { ...typography.button, color: COLORS.textInverse, textAlign: 'center' },
  cancelButton: { alignItems: 'center', minHeight: CONTROL.minTouchSize, justifyContent: 'center', marginTop: SPACING.xs, width: '100%' },
  cancelText: { ...typography.body2, color: COLORS.textSecondary },
});
