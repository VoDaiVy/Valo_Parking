import Constants, { ExecutionEnvironment } from 'expo-constants';
import { useRef, useState } from 'react';
import { Platform } from 'react-native';

import { config } from '@/config/env';
import { useAppAlert } from '@/contexts/AppAlertContext';
import { useAuth } from './useAuth';

// Import the native module only on demand so email login still works in Expo Go.
export function useGoogleSignIn() {
  const { googleLogin } = useAuth();
  const { alert } = useAppAlert();
  const [loading, setLoading] = useState(false);
  const inFlight = useRef(false);

  const signIn = async () => {
    if (inFlight.current) return;
    if (Constants.executionEnvironment === ExecutionEnvironment.StoreClient) {
      alert('Google sign-in requires an app build', 'Install the VALO development build or APK. Google sign-in is unavailable in Expo Go.');
      return;
    }
    if (!config.googleClientId || (Platform.OS === 'ios' && !config.googleIosClientId)) {
      alert('Google sign-in unavailable', 'Configure EXPO_PUBLIC_GOOGLE_CLIENT_ID (Web client ID) and, on iOS, EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID.');
      return;
    }

    inFlight.current = true;
    setLoading(true);
    try {
      const { GoogleSignin, isSuccessResponse } = require('@react-native-google-signin/google-signin') as typeof import('@react-native-google-signin/google-signin');
      GoogleSignin.configure({
        webClientId: config.googleClientId,
        iosClientId: config.googleIosClientId || undefined,
        offlineAccess: false,
      });
      if (Platform.OS === 'android') await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
      // Preserve the account chooser when the user logs out of VALO and signs in again.
      if (GoogleSignin.hasPreviousSignIn()) await GoogleSignin.signOut();
      const result = await GoogleSignin.signIn();
      if (!isSuccessResponse(result)) return;
      if (!result.data.idToken) throw new Error('Google did not return an ID token. Check the Web client ID configuration.');
      await googleLogin({ idToken: result.data.idToken });
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
      if (code === 'SIGN_IN_CANCELLED') return;
      const message = code === '10' || code === 'DEVELOPER_ERROR'
        ? 'Google configuration does not match this app. Check the Android package, APK signing SHA-1 and Web client ID in Google Cloud.'
        : error instanceof Error ? error.message : 'Google sign-in failed. Please try again.';
      alert('Google sign-in failed', message);
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  };

  return { loading, enabled: true, signIn };
}
