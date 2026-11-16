import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { EnglishLanguageBoundary } from '@/contexts/LanguageContext';

import { ForgotPasswordScreen } from '@/screens/auth/ForgotPasswordScreen';
import AuthScreen from '@/screens/auth/AuthScreen';
import { ResetPasswordScreen } from '@/screens/auth/ResetPasswordScreen';
import { VerifyOTPScreen } from '@/screens/auth/VerifyOTPScreen';

import type { AuthStackParamList } from './types';

const Stack = createNativeStackNavigator<AuthStackParamList>();

export const AuthNavigator = () => (
  <EnglishLanguageBoundary>
  <Stack.Navigator screenOptions={{ headerShown: false }}>
    <Stack.Screen component={AuthScreen} name="Login" />
    <Stack.Screen component={AuthScreen} name="Register" />
    <Stack.Screen component={ForgotPasswordScreen} name="ForgotPassword" />
    <Stack.Screen component={VerifyOTPScreen} name="VerifyOTP" />
    <Stack.Screen component={ResetPasswordScreen} name="ResetPassword" />
  </Stack.Navigator>
  </EnglishLanguageBoundary>
);
