import { useLanguage } from '@/contexts/LanguageContext';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import { StyleSheet } from 'react-native';

import { AppText, Button, Input } from '@/components/common';
import { Screen } from '@/components/layout/Screen';
import { useToast } from '@/hooks/useToast';
import type { AuthStackParamList } from '@/navigation/types';
import { authService } from '@/services/api/auth';
import { colors } from '@/theme';
import { isValidOtp } from '@/utils/validation';

type Props = NativeStackScreenProps<AuthStackParamList, 'VerifyOTP'>;

export const VerifyOTPScreen = ({ navigation, route }: Props) => {
  const { t: translateUi } = useLanguage();
  const toast = useToast();
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState('');
  const isRegisterVerification = route.params.purpose === 'register';

  const handleSubmit = async () => {
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
        navigation.popToTop();
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
    setResending(true);
    setError('');
    try {
      if (isRegisterVerification) {
        await authService.sendOTP({ email: route.params.email });
      } else {
        await authService.forgotPassword({ email: route.params.email });
      }
      toast.showSuccess('OTP sent', `A new OTP was sent to ${route.params.email}.`);
    } catch (resendError) {
      setError(resendError instanceof Error ? resendError.message : 'Unable to resend OTP.');
    } finally {
      setResending(false);
    }
  };

  return (
    <Screen scrollable contentStyle={styles.content}>
      <AppText variant="h1">{translateUi("Verify OTP")}</AppText>
      <AppText color={colors.light.text.secondary}>
        {" "}{translateUi("Enter the OTP sent to")}{" "}{route.params.email}.
      </AppText>
      <Input keyboardType="number-pad" label="OTP" maxLength={6} style={styles.otp} onChangeText={setOtp} value={otp} />
      {error ? <AppText color={colors.error.main}>{translateUi(error)}</AppText> : null}
      <Button loading={loading} title={translateUi("Verify")} onPress={handleSubmit} />
      <Button loading={resending} title={translateUi("Resend OTP")} variant="outline" onPress={handleResend} />
    </Screen>
  );
};

const styles = StyleSheet.create({
  content: { width: '100%', maxWidth: 480, alignSelf: 'center', justifyContent: 'center' },
  otp: { textAlign: 'center', letterSpacing: 8, fontVariant: ['tabular-nums'] },
});
