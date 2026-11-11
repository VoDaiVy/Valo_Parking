import * as Google from 'expo-auth-session/providers/google';
import * as WebBrowser from 'expo-web-browser';
import { useRef, useState } from 'react';

import { config } from '@/config/env';
import { useAppAlert } from '@/contexts/AppAlertContext';
import { useAuth } from './useAuth';

WebBrowser.maybeCompleteAuthSession();

// Metro selects useGoogleSignIn.native.ts on Android/iOS.
export function useGoogleSignIn() {
  const { googleLogin } = useAuth();
  const { alert } = useAppAlert();
  const [loading, setLoading] = useState(false);
  const inFlight = useRef(false);
  const [request, , promptAsync] = Google.useIdTokenAuthRequest({
    // Keep email login usable when Google has not been configured yet.
    webClientId: config.googleClientId || 'google-not-configured',
    scopes: ['openid', 'profile', 'email'],
    selectAccount: true,
  });

  const signIn = async () => {
    if (inFlight.current) return;
    if (!config.googleClientId) {
      alert('Google sign-in unavailable', 'Missing EXPO_PUBLIC_GOOGLE_CLIENT_ID.');
      return;
    }
    if (!request) return;
    inFlight.current = true;
    setLoading(true);
    try {
      const result = await promptAsync();
      if (result.type === 'cancel' || result.type === 'dismiss') return;
      if (result.type !== 'success') throw new Error('Google authorization failed. Please try again.');
      const idToken = result.authentication?.idToken || result.params.id_token;
      if (!idToken) throw new Error('Unable to retrieve the Google ID token.');
      await googleLogin({ idToken });
    } catch (error) {
      alert('Google sign-in failed', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  };

  return { loading, enabled: Boolean(request), signIn };
}
