import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * TEMPORARY diagnostic for the iOS photo-picker WatchdogTermination.
 *
 * Remove this file, its call sites in photo-upload.ts, and the launch-time
 * report in src/app/_layout.tsx once the failing step is identified.
 *
 * Why this exists rather than Sentry breadcrumbs: a watchdog kill produces no
 * JS stack and no catchable error, and Sentry can only report it on the *next*
 * launch by inferring that the previous one never shut down cleanly. On this
 * device that inference has not been arriving -- build 11 crashed and produced
 * no Sentry event at all. Writing each step to disk as it happens removes
 * every dependency in that chain: no network, no Sentry init, no next-launch
 * inference, no dev build. Whatever the last recorded step is, that is the
 * call that never returned.
 *
 * AsyncStorage writes are asynchronous and a hard kill could in principle lose
 * the most recent one, but the observed failure hangs for minutes before the
 * OS gives up -- far longer than a small write needs to land.
 */
const KEY = 'gymos.photoDebug.lastStep';

export interface PhotoDebugMark {
  step: string;
  at: string;
}

/** Fire-and-forget: never awaited by the flow it measures, and never throws --
 *  instrumentation must not be able to break or slow what it is observing. */
export function recordPhotoStep(step: string): void {
  const mark: PhotoDebugMark = { step, at: new Date().toISOString() };
  AsyncStorage.setItem(KEY, JSON.stringify(mark)).catch(() => {
    // deliberately ignored -- see above
  });
}

/** Reads the last recorded step, if any. Returns null when the previous photo
 *  flow completed normally (it clears its own marker) or was never run. */
export async function readPhotoStep(): Promise<PhotoDebugMark | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof (parsed as PhotoDebugMark).step === 'string' &&
      typeof (parsed as PhotoDebugMark).at === 'string'
    ) {
      return parsed as PhotoDebugMark;
    }
    return null;
  } catch {
    return null;
  }
}

export async function clearPhotoStep(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    // ignored -- a stale marker is harmless, it just reports once more
  }
}
