import AsyncStorage from '@react-native-async-storage/async-storage';

/** Story 31.1 (MA-09): the device's record of the Shield notices a member has dismissed, and of the one-time "you're back" card already shown. Ids come
 * from lib/shieldView.ts (`saved:<Monday>`, `earned:<Monday>`, `restored:<window start>`), so one store holds all three kinds. Per user and gym, a JSON
 * id set capped at MAX_IDS (the newest are kept). Fail closed like services/loyaltySeen.ts: when storage cannot be read, `readDismissed` returns null and
 * the caller shows no notice rather than risk repeating one. Nothing here is sent anywhere. */

const KEY_PREFIX = 'gymos.shieldNotices.v1.';
export const MAX_IDS = 50;

export function shieldNoticesKey(userId: string, gymId: string): string {
  return `${KEY_PREFIX}${userId}.${gymId}`;
}

/** The dismissed ids, or null when storage cannot be read. A corrupt value reads as empty, so the next write replaces it. */
export async function readDismissed(userId: string, gymId: string): Promise<Set<string> | null> {
  try {
    const raw = await AsyncStorage.getItem(shieldNoticesKey(userId, gymId));
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((value): value is string => typeof value === 'string'));
  } catch (error) {
    return error instanceof SyntaxError ? new Set() : null;
  }
}

// Writes are serialised through one promise chain: `recordDismissed` is a read-modify-write, so two of them racing (a dismissal and the
// restored-card record) would each read the old set and the later write would drop the other's id.
let writeChain: Promise<unknown> = Promise.resolve();

async function addId(userId: string, gymId: string, id: string): Promise<boolean> {
  try {
    const existing = await readDismissed(userId, gymId);
    if (existing === null) return false;
    if (existing.has(id)) return true;
    const merged = [...existing, id].slice(-MAX_IDS);
    await AsyncStorage.setItem(shieldNoticesKey(userId, gymId), JSON.stringify(merged));
    return true;
  } catch {
    return false;
  }
}

/** Adds `id` to the record. Returns false when it could not be stored (an unreadable record is never overwritten). Calls run one after the other. */
export function recordDismissed(userId: string, gymId: string, id: string): Promise<boolean> {
  const next = writeChain.then(() => addId(userId, gymId, id));
  writeChain = next;
  return next;
}

/** Sign-out: forgets every member's record on this device (the store is keyed by user and gym, so a sign-out is the only moment a record becomes
 * someone else's). Never throws. */
export async function clearShieldNotices(): Promise<void> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const mine = keys.filter((key) => key.startsWith(KEY_PREFIX));
    if (mine.length > 0) await AsyncStorage.multiRemove(mine);
  } catch {
    // Best effort: nothing here may block a sign-out.
  }
}
