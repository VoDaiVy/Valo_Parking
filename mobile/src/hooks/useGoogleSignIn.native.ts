import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as GoogleAuthSession from 'expo-auth-session/providers/google';
import * as WebBrowser from 'expo-web-browser';
import { useRef, useState } from 'react';
import { Platform } from 'react-native';

import { config } from '@/config/env';
import { useAppAlert } from '@/contexts/AppAlertContext';
import { useAuth } from './useAuth';

WebBrowser.maybeCompleteAuthSession();

// Import the native module only on demand so email login still works in Expo Go.
export function useGoogleSignIn() {
  const { googleLogin } = useAuth();
  const { alert } = useAppAlert();
  const [loading, setLoading] = useState(false);
  const inFlight = useRef(false);
  const [request, , promptAsync] = GoogleAuthSession.useIdTokenAuthRequest({
    webClientId: config.googleClientId || 'google-not-configured',
    androidClientId: config.googleAndroidClientId || undefined,
    iosClientId: config.googleIosClientId || undefined,
    scopes: ['openid', 'profile', 'email'],
    selectAccount: true,
  });

  const signIn = async () => {
    if (inFlight.current) return;
    if (!config.googleClientId || (Platform.OS === 'ios' && !config.googleIosClientId)) {
      alert('Google sign-in unavailable', 'Configure EXPO_PUBLIC_GOOGLE_CLIENT_ID (Web client ID) and, on iOS, EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID.');
      return;
    }

    inFlight.current = true;
    setLoading(true);
    try {
      if (Constants.executionEnvironment === ExecutionEnvironment.StoreClient) {
        if (!request) throw new Error('Google authorization is still loading. Please try again.');
        const result = await promptAsync();
        if (result.type === 'cancel' || result.type === 'dismiss') return;
        if (result.type !== 'success') throw new Error('Google authorization failed. Please try again.');
        const idToken = result.authentication?.idToken || result.params?.id_token;
        if (!idToken) throw new Error('Unable to retrieve the Google ID token.');
        await googleLogin({ idToken });
        return;
      }
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

  return { loading, enabled: Boolean(config.googleClientId && request), signIn };
}
