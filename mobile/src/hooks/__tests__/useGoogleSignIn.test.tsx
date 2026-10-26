import { act, renderHook } from '@testing-library/react-native';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { config } from '@/config/env';
import { useGoogleSignIn } from '../useGoogleSignIn.native';

const mockGoogleLogin = jest.fn();
const mockAlert = jest.fn();
const mockNativeLoaded = jest.fn();
const mockSdk = {
  configure: jest.fn(),
  hasPlayServices: jest.fn(),
  hasPreviousSignIn: jest.fn(),
  signOut: jest.fn(),
  signIn: jest.fn(),
};

jest.mock('@/config/env', () => ({ config: { googleClientId: 'web-client', googleIosClientId: '' } }));
jest.mock('../useAuth', () => ({ useAuth: () => ({ googleLogin: mockGoogleLogin }) }));
jest.mock('@/contexts/AppAlertContext', () => ({ useAppAlert: () => ({ alert: mockAlert }) }));
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { executionEnvironment: 'standalone' },
  ExecutionEnvironment: { StoreClient: 'storeClient' },
}));
jest.mock('@react-native-google-signin/google-signin', () => {
  mockNativeLoaded();
  return { GoogleSignin: mockSdk, isSuccessResponse: (response: { type: string }) => response.type === 'success' };
});

beforeEach(() => {
  jest.clearAllMocks();
  Platform.OS = 'android';
  config.googleClientId = 'web-client';
  Constants.executionEnvironment = 'standalone' as typeof Constants.executionEnvironment;
  mockSdk.hasPreviousSignIn.mockReturnValue(false);
  mockSdk.hasPlayServices.mockResolvedValue(true);
  mockSdk.signIn.mockResolvedValue({ type: 'success', data: { idToken: 'google-token' } });
  mockGoogleLogin.mockResolvedValue(undefined);
});

it('forwards the server ID token and clears a previous Google account session', async () => {
  mockSdk.hasPreviousSignIn.mockReturnValue(true);
  const { result } = renderHook(useGoogleSignIn);
  await act(() => result.current.signIn());
  expect(mockSdk.configure).toHaveBeenCalledWith(expect.objectContaining({ webClientId: 'web-client', offlineAccess: false }));
  expect(mockSdk.signOut).toHaveBeenCalledTimes(1);
  expect(mockGoogleLogin).toHaveBeenCalledWith({ idToken: 'google-token' });
  expect(result.current.loading).toBe(false);
});

it.each(['missing configuration', 'Expo Go'])('does not load the native SDK for %s', async (condition) => {
  if (condition === 'Expo Go') Constants.executionEnvironment = 'storeClient' as typeof Constants.executionEnvironment;
  else config.googleClientId = '';
  const { result } = renderHook(useGoogleSignIn);
  await act(() => result.current.signIn());
  expect(mockNativeLoaded).not.toHaveBeenCalled();
  expect(mockSdk.signIn).not.toHaveBeenCalled();
  expect(mockGoogleLogin).not.toHaveBeenCalled();
  expect(mockAlert).toHaveBeenCalledTimes(1);
});

it.each(['response', 'exception'])('silently handles cancellation via %s', async (kind) => {
  if (kind === 'response') mockSdk.signIn.mockResolvedValue({ type: 'cancelled' });
  else mockSdk.signIn.mockRejectedValue({ code: 'SIGN_IN_CANCELLED' });
  const { result } = renderHook(useGoogleSignIn);
  await act(() => result.current.signIn());
  expect(mockGoogleLogin).not.toHaveBeenCalled();
  expect(mockAlert).not.toHaveBeenCalled();
  expect(result.current.loading).toBe(false);
});

it('reports a missing token without submitting an empty credential', async () => {
  mockSdk.signIn.mockResolvedValue({ type: 'success', data: { idToken: null } });
  const { result } = renderHook(useGoogleSignIn);
  await act(() => result.current.signIn());
  expect(mockGoogleLogin).not.toHaveBeenCalled();
  expect(mockAlert).toHaveBeenCalledWith('Google sign-in failed', expect.stringContaining('ID token'));
  expect(result.current.loading).toBe(false);
});

it('ignores a second press while sign-in is pending', async () => {
  let finish!: (response: unknown) => void;
  mockSdk.signIn.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  const { result } = renderHook(useGoogleSignIn);
  let pending!: Promise<void>;
  await act(async () => { pending = result.current.signIn(); await Promise.resolve(); });
  expect(result.current.loading).toBe(true);
  await act(() => result.current.signIn());
  expect(mockSdk.signIn).toHaveBeenCalledTimes(1);
  await act(async () => { finish({ type: 'cancelled' }); await pending; });
  expect(result.current.loading).toBe(false);
});

it.each(['SDK', 'backend'])('resets loading and allows retry after %s failure', async (source) => {
  if (source === 'SDK') mockSdk.signIn.mockRejectedValueOnce(new Error('SDK failure'));
  else mockGoogleLogin.mockRejectedValueOnce(new Error('backend failure'));
  const { result } = renderHook(useGoogleSignIn);
  await act(() => result.current.signIn());
  expect(mockAlert).toHaveBeenCalledWith('Google sign-in failed', `${source} failure`);
  expect(result.current.loading).toBe(false);
  await act(() => result.current.signIn());
  expect(mockSdk.signIn).toHaveBeenCalledTimes(2);
});
