import { jest } from '@jest/globals';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';

// Mocks
jest.unstable_mockModule('expo-notifications', () => ({
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  getExpoPushTokenAsync: jest.fn(),
  setNotificationChannelAsync: jest.fn(),
  addPushTokenListener: jest.fn(() => ({ remove: jest.fn() })),
}));

jest.unstable_mockModule('expo-device', () => ({
  isDevice: true,
}));

// Import the module under test with mocked dependencies
const NotificationsMock = await import('expo-notifications');
const DeviceMock = await import('expo-device');
const { registerPushToken, subscribeToPushTokenChanges } = await import('./pushTokens');

describe('pushTokens service', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  test('registerPushToken respects permission denied', async () => {
    (NotificationsMock.getPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'denied' });

    await expect(registerPushToken('user-1')).resolves.toBeUndefined();
    expect(NotificationsMock.getExpoPushTokenAsync).not.toHaveBeenCalled();
  });

  test('registerPushToken requests permission then fetches token and upserts', async () => {
    (NotificationsMock.getPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'undetermined' });
    (NotificationsMock.requestPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'granted' });
    (NotificationsMock.getExpoPushTokenAsync as jest.Mock).mockResolvedValue({ data: 'ExponentPushToken[TEST]' });

    // spy on supabase upsert by mocking supabase client
    const supabaseModule = await import('@/lib/supabase');
    jest.spyOn(supabaseModule.supabase, 'from').mockReturnValue({ upsert: jest.fn().mockResolvedValue({}) } as any);

    await expect(registerPushToken('user-1')).resolves.toBeUndefined();
    expect(NotificationsMock.getExpoPushTokenAsync).toHaveBeenCalled();
  });

  test('subscribeToPushTokenChanges registers listener only on device', () => {
    (DeviceMock.isDevice as any) = true;
    const unsubscribe = subscribeToPushTokenChanges('user-2');
    expect(NotificationsMock.addPushTokenListener).toHaveBeenCalled();
    unsubscribe();
  });

  test('subscribeToPushTokenChanges is no-op off device', () => {
    (DeviceMock.isDevice as any) = false;
    const unsubscribe = subscribeToPushTokenChanges('user-2');
    expect(NotificationsMock.addPushTokenListener).not.toHaveBeenCalled();
    expect(typeof unsubscribe).toBe('function');
  });
});
