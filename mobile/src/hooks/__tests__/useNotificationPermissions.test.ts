import { renderHook, waitFor } from '@testing-library/react-native';
import { useNotificationPermissions } from '../useNotificationPermissions';

jest.mock('@/utils/notificationRuntime', () => ({ isExpoGo: false }));
jest.mock('react-native', () => {
  const actual = jest.requireActual('react-native');
  actual.Platform.OS = 'android';
  return actual;
});
jest.mock('expo-notifications', () => ({
  AndroidImportance: { HIGH: 4 },
  AndroidNotificationVisibility: { PRIVATE: 0 },
  setNotificationChannelAsync: jest.fn().mockResolvedValue(null),
  getPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
}));

test('creates the delivery channel even when permission was granted previously', async () => {
  const notifications = jest.requireMock('expo-notifications');
  const { result } = renderHook(() => useNotificationPermissions());
  await waitFor(() => expect(result.current.status).toBe('granted'));
  expect(notifications.setNotificationChannelAsync).toHaveBeenCalledWith(
    'valo-notifications', expect.objectContaining({ importance: 4, sound: 'default' }),
  );
  expect(notifications.setNotificationChannelAsync.mock.invocationCallOrder[0])
    .toBeLessThan(notifications.getPermissionsAsync.mock.invocationCallOrder[0]);
});
