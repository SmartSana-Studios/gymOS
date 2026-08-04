import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { devicePushTokenSchema } from '@gymos/types';

import { supabase } from '@/lib/supabase';

/** Fetches a fresh Expo push token (never the raw native device token --
 * `addPushTokenListener`'s callback below hands back a native FCM/APNs
 * DevicePushToken, confirmed via live device testing to be a *different*
 * format than `getExpoPushTokenAsync()`'s `ExponentPushToken[...]` string,
 * which is what Expo's push service actually accepts) and upserts it.
 * Added defensive checks: log & return when no token is obtained. */
async function fetchAndStorePushToken(userId: string): Promise<void> {
  try {
    const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
    const maybe = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );
    // SDK may return an object like { data: 'ExponentPushToken[...'] } or similar
    const token = (maybe && (maybe as any).data) ?? (maybe as any);
    if (!token) {
      console.warn('[push] getExpoPushTokenAsync returned no token');
      return;
    }

    await upsertPushToken(userId, token, Platform.OS as 'ios' | 'android');
  } catch (err) {
    console.error('[push] fetchAndStorePushToken failed', err);
  }
}

/** Story 6.1 AC #1: registers the device's Expo push token, gated on a
 * physical device and notification permission. `try/catch` around the whole
 * path is deliberate -- a missing EAS `projectId`, a denied permission, or a
 * network failure must never crash the app or block navigation, matching
 * checkin.ts's never-throws service-function resilience pattern. This is a
 * best-effort background action, not a load-blocking one. */
export async function registerPushToken(userId: string): Promise<void> {
  try {
    if (!Device.isDevice) return;

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'default',
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }

    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== 'granted') return;

    await fetchAndStorePushToken(userId);
  } catch (err) {
    console.error('[push] registerPushToken failed', err);
  }
}

async function upsertPushToken(userId: string, expoPushToken: string, platform: 'ios' | 'android'): Promise<void> {
  const parsed = devicePushTokenSchema.safeParse({ expoPushToken, platform });
  if (!parsed.success) return;

  const { error } = await supabase.from('device_push_tokens').upsert(
    { user_id: userId, expo_push_token: parsed.data.expoPushToken, platform: parsed.data.platform },
    { onConflict: 'user_id,expo_push_token' },
  );
  if (error) throw error;
}

/** Story 6.1 AC #1: Expo's SDK 57 docs document that a push token may be
 * changed by the push notification service while the app is running.
 * `addPushTokenListener`'s own callback argument is the raw native
 * DevicePushToken, not an ExpoPushToken -- Expo's docs are explicit that a
 * native token rotation should trigger a fresh `getExpoPushTokenAsync()`
 * call, not a direct store of the listener's payload (confirmed the hard
 * way: an earlier version of this function stored the raw FCM token string
 * directly, producing a `device_push_tokens` row Expo's push service could
 * never actually deliver to).
 *
 * Guard listener registration on Device.isDevice so simulators / server
 * contexts don't register unnecessary listeners. */
export function subscribeToPushTokenChanges(userId: string): () => void {
  if (!Device.isDevice) return () => {};

  const subscription = Notifications.addPushTokenListener(() => {
    void fetchAndStorePushToken(userId).catch((err) => {
      console.error('[push] subscribeToPushTokenChanges refresh failed', err);
    });
  });
  return () => subscription.remove();
}
