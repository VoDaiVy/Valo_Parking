import { act, renderHook } from '@testing-library/react-native';

// Explicit extension bypasses Jest's React Native platform resolution.
const { useGoogleSignIn } = require('../useGoogleSignIn.ts') as typeof import('../useGoogleSignIn');

const mockGoogleLogin = jest.fn();
const mockAlert = jest.fn();
const mockPrompt = jest.fn();
jest.mock('@/config/env', () => ({ config: { googleClientId: 'web-client' } }));
jest.mock('../useAuth', () => ({ useAuth: () => ({ googleLogin: mockGoogleLogin }) }));
jest.mock('@/contexts/AppAlertContext', () => ({ useAppAlert: () => ({ alert: mockAlert }) }));
jest.mock('expo-web-browser', () => ({ maybeCompleteAuthSession: jest.fn() }));
jest.mock('expo-auth-session/providers/google', () => ({ useIdTokenAuthRequest: () => [{}, null, mockPrompt] }));

beforeEach(() => jest.clearAllMocks());

it('forwards the web Google token to VALO', async () => {
  mockPrompt.mockResolvedValue({ type: 'success', params: { id_token: 'web-token' } });
  const { result } = renderHook(useGoogleSignIn);
  await act(() => result.current.signIn());
  expect(mockGoogleLogin).toHaveBeenCalledWith({ idToken: 'web-token' });
  expect(result.current.loading).toBe(false);
});

it.each(['cancel', 'dismiss'])('does not submit a token or alert on %s', async (type) => {
  mockPrompt.mockResolvedValue({ type });
  const { result } = renderHook(useGoogleSignIn);
  await act(() => result.current.signIn());
  expect(mockGoogleLogin).not.toHaveBeenCalled();
  expect(mockAlert).not.toHaveBeenCalled();
  expect(result.current.loading).toBe(false);
});
