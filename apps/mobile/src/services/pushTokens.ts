import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { devicePushTokenSchema } from '@gymos/types';

import { supabase } from '@/lib/supabase';

/** Guards the re-entrant registration cycle documented on
 * `subscribeToPushTokenChanges` below: expo-notifications' native
 * `didRegister()` both resolves `getDevicePushTokenAsync()`'s promise *and*
 * emits `onDevicePushToken`, so `registerPushToken()`'s own initial fetch
 * always re-fires our listener once. Dropping listener callbacks that land
 * while that first fetch is still in flight keeps app start to a single
 * round-trip to Expo's push service instead of two. */
let registrationInFlight = false;

/** `${userId}:${expoPushToken}` of the last row successfully written to
 * `device_push_tokens`, so an unchanged token is never re-upserted. Keyed by
 * user as well as token because the token is a property of the *device* --
 * if one member logs out and another logs in on the same phone, the token is
 * identical but the row that needs writing is a different one. */
let lastStoredTokenKey: string | null = null;

/** Fetches a fresh Expo push token (never the raw native device token --
 * `addPushTokenListener`'s callback below hands back a native FCM/APNs
 * DevicePushToken, confirmed via live device testing to be a *different*
 * format than `getExpoPushTokenAsync()`'s `ExponentPushToken[...]` string,
 * which is what Expo's push service actually accepts) and upserts it.
 * Added defensive checks: log & return when no token is obtained. */
async function fetchAndStorePushToken(
  userId: string,
  devicePushToken?: Notifications.DevicePushToken,
): Promise<void> {
  try {
    const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
    const maybe = await Notifications.getExpoPushTokenAsync({
      ...(projectId ? { projectId } : {}),
      // When our listener already has the native token in hand, hand it
      // straight back. getExpoPushTokenAsync's first line is
      // `options.devicePushToken || (await getDevicePushTokenAsync())`, so
      // supplying it skips the native re-registration -- which is the *only*
      // thing that re-emits `onDevicePushToken`. Omitting this is what made
      // this function feed itself unboundedly; see subscribeToPushTokenChanges.
      ...(devicePushToken ? { devicePushToken } : {}),
    });
    // SDK may return an object like { data: 'ExponentPushToken[...'] } or similar
    const token = (maybe && (maybe as any).data) ?? (maybe as any);
    if (!token) {
      console.warn('[push] getExpoPushTokenAsync returned no token');
      return;
    }

    const tokenKey = `${userId}:${token}`;
    if (tokenKey === lastStoredTokenKey) return;

    await upsertPushToken(userId, token, Platform.OS as 'ios' | 'android');
    lastStoredTokenKey = tokenKey;
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

    registrationInFlight = true;
    try {
      await fetchAndStorePushToken(userId);
    } finally {
      registrationInFlight = false;
    }
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
 * We still resolve through Expo's service -- but we *feed it* the native
 * token the listener just handed us rather than letting it fetch its own.
 * This is load-bearing, not a micro-optimisation. Native `didRegister()`
 * (ios/ExpoNotifications/PushToken/PushTokenModule.swift) both resolves the
 * pending `getDevicePushTokenAsync()` promise and emits `onDevicePushToken`,
 * so a listener that re-fetches the device token re-enters itself forever:
 * fetch -> native register -> emit -> listener -> fetch -> ... Because that
 * emit happens *before* getExpoPushTokenAsync's own HTTPS call, each cycle
 * spawns the next without awaiting its own network request, so the requests
 * fan out concurrently rather than serialising. Shipped in builds 7-13 and
 * caught by Sentry GYMOS-MOBILE-2 -- a `WatchdogTermination` whose 100
 * breadcrumbs (Sentry's cap; the true count was higher) were all POSTs to
 * `exp.host/--/api/v2/push/getExpoPushToken` inside a 90ms window, on every
 * launch for every fully-onboarded member.
 *
 * Guard listener registration on Device.isDevice so simulators / server
 * contexts don't register unnecessary listeners. */
export function subscribeToPushTokenChanges(userId: string): () => void {
  if (!Device.isDevice) return () => {};

  const subscription = Notifications.addPushTokenListener((devicePushToken) => {
    if (registrationInFlight) return;
    void fetchAndStorePushToken(userId, devicePushToken).catch((err) => {
      console.error('[push] subscribeToPushTokenChanges refresh failed', err);
    });
  });
  return () => subscription.remove();
}
