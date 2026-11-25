/** Owner decision 2026-11-25: push notifications follow the language the member actually sees. The server writes them in `users.preferred_language` (fr, else en), but the app takes
 * its display language from the phone and never wrote that value back, so a French phone with the default `en` received English pushes in a French app.
 *
 * Deliberately light: the language last copied to the server is remembered on the phone per member, so in the normal case this is ONE local read and no network call at all; the
 * single UPDATE (own row, the one column a member may change) happens only when the displayed language differs from that note. It runs after the first screen is shown and never
 * blocks it. Offline or on a refused write nothing is noted, so the next start tries again. */
export type SyncedLanguage = 'en' | 'fr';

export const languageSyncKey = (userId: string): string => `gymos.preferredLanguageSynced.${userId}`;

export interface LanguageSyncDeps {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  /** Writes users.preferred_language for this member; resolves true when the write landed. */
  updateLanguage: (userId: string, language: SyncedLanguage) => Promise<boolean>;
}

/** True when an update was sent and accepted, false when nothing needed sending or the write did not land. Never throws. */
export async function syncPreferredLanguage(userId: string, language: SyncedLanguage, deps: LanguageSyncDeps): Promise<boolean> {
  try {
    const key = languageSyncKey(userId);
    if ((await deps.getItem(key)) === language) return false;
    if (!(await deps.updateLanguage(userId, language))) return false;
    await deps.setItem(key, language);
    return true;
  } catch {
    return false;
  }
}
