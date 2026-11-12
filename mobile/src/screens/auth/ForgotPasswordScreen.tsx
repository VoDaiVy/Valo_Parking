import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { AuthRecoveryLayout, RecoveryButton, RecoveryError, recoveryStyles as styles } from '@/components/auth/AuthRecoveryLayout';
import { COLORS } from '@/constants/theme';
import type { AuthStackParamList } from '@/navigation/types';
import { authService } from '@/services/api/auth';
import { isValidEmail } from '@/utils/validation';

type Props = NativeStackScreenProps<AuthStackParamList, 'ForgotPassword'>;

export const ForgotPasswordScreen = ({ navigation }: Props) => {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    if (loading) return;
    if (!isValidEmail(email.trim().toLowerCase())) {
      setError('Please enter a valid email address.');
      return;
    }

    setLoading(true);
      setError('');
    try {
      await authService.forgotPassword({ email: email.trim().toLowerCase() });
      navigation.navigate('VerifyOTP', { email: email.trim().toLowerCase(), purpose: 'reset' });
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Unable to send OTP.');
    } finally {
      setLoading(false);
    }
  };

  const backToLogin = () => navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
  return <AuthRecoveryLayout showBackButton={false} icon="key-outline" title="Forgot your password?" description="No worries. Enter your account email and we'll send you a code to reset your password." onBack={backToLogin}>
    <Text style={styles.label}>Email address</Text>
    <View style={[styles.inputWrap, error ? { borderColor: COLORS.error } : undefined]}>
      <Ionicons name="mail-outline" size={20} color={COLORS.textMuted} />
      <TextInput accessibilityLabel="Email address" autoCapitalize="none" autoCorrect={false} autoComplete="email" keyboardType="email-address" textContentType="emailAddress" placeholder="you@example.com" placeholderTextColor={COLORS.textMuted} editable={!loading} style={styles.input} value={email} onChangeText={(value) => { setEmail(value); setError(''); }} returnKeyType="send" onSubmitEditing={handleSubmit} />
    </View>
    <Text style={styles.hint}>Use the email address linked to your VALO account.</Text>
    <RecoveryError message={error} />
    <RecoveryButton title="Send verification code" loading={loading} onPress={handleSubmit} />
  </AuthRecoveryLayout>;
};
