import AsyncStorage from '@react-native-async-storage/async-storage';

// Story 20.6: device-local record of which free-session grants the Rewards
// card has already announced. Key is per user and gym (`scope`).
const KEY_PREFIX = 'gymos.loyaltySeenGrants.v1.';
const MAX_IDS = 200;

/** Seen grant ids, or null when storage cannot be read (the caller then
 * shows no headline rather than risk repeating it). */
export async function readSeenGrants(scope: string): Promise<Set<string> | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY_PREFIX + scope);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    // A corrupt value is treated as empty so the next record overwrites it.
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((v): v is string => typeof v === 'string'));
  } catch (error) {
    return error instanceof SyntaxError ? new Set() : null;
  }
}

/** Returns false when the record could not be stored. */
export async function recordSeenGrants(scope: string, ids: string[]): Promise<boolean> {
  try {
    const existing = await readSeenGrants(scope);
    if (existing === null) return false;
    const merged = [...existing, ...ids.filter((id) => !existing.has(id))].slice(-MAX_IDS);
    await AsyncStorage.setItem(KEY_PREFIX + scope, JSON.stringify(merged));
    return true;
  } catch {
    return false;
  }
}
