import { useLanguage } from '@/contexts/LanguageContext';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import { StyleSheet } from 'react-native';

import { AppText, Button, Input } from '@/components/common';
import { Screen } from '@/components/layout/Screen';
import type { AuthStackParamList } from '@/navigation/types';
import { authService } from '@/services/api/auth';
import { colors } from '@/theme';
import { isValidEmail } from '@/utils/validation';

type Props = NativeStackScreenProps<AuthStackParamList, 'ForgotPassword'>;

export const ForgotPasswordScreen = ({ navigation }: Props) => {
  const { t: translateUi } = useLanguage();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    if (!isValidEmail(email)) {
      setError('Please enter a valid email address.');
      return;
    }

    setLoading(true);
      setError('');
    try {
      await authService.forgotPassword({ email: email.trim() });
      navigation.navigate('VerifyOTP', { email: email.trim(), purpose: 'reset' });
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Unable to send OTP.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen scrollable contentStyle={styles.content}>
      <AppText variant="h1">{translateUi("Reset Password")}</AppText>
      <Input keyboardType="email-address" label="Email" onChangeText={setEmail} value={email} />
      {error ? <AppText color={colors.error.main}>{translateUi(error)}</AppText> : null}
      <Button loading={loading} title={translateUi("Send OTP")} onPress={handleSubmit} />
    </Screen>
  );
};

const styles = StyleSheet.create({
  content: { width: '100%', maxWidth: 480, alignSelf: 'center', justifyContent: 'center' },
});
