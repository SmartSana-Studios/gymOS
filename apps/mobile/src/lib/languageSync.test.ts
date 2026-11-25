import { describe, expect, it, vi } from 'vitest';

import { languageSyncKey, syncPreferredLanguage, type LanguageSyncDeps } from './languageSync';

function deps(over: Partial<LanguageSyncDeps> = {}, stored: Record<string, string> = {}) {
  const store = { ...stored };
  const d: LanguageSyncDeps = {
    getItem: vi.fn(async (k: string) => store[k] ?? null),
    setItem: vi.fn(async (k: string, v: string) => {
      store[k] = v;
    }),
    updateLanguage: vi.fn(async () => true),
    ...over,
  };
  return { d, store };
}

describe('syncPreferredLanguage', () => {
  it('sends nothing when the displayed language is the one already copied to the server (the normal case: no network call)', async () => {
    const { d } = deps({}, { [languageSyncKey('u1')]: 'fr' });
    expect(await syncPreferredLanguage('u1', 'fr', d)).toBe(false);
    expect(d.updateLanguage).not.toHaveBeenCalled();
    expect(d.setItem).not.toHaveBeenCalled();
  });

  it('sends one update when nothing was copied yet, then notes it', async () => {
    const { d, store } = deps();
    expect(await syncPreferredLanguage('u1', 'fr', d)).toBe(true);
    expect(d.updateLanguage).toHaveBeenCalledTimes(1);
    expect(d.updateLanguage).toHaveBeenCalledWith('u1', 'fr');
    expect(store[languageSyncKey('u1')]).toBe('fr');
    // a second start with the same language is silent
    expect(await syncPreferredLanguage('u1', 'fr', d)).toBe(false);
    expect(d.updateLanguage).toHaveBeenCalledTimes(1);
  });

  it('sends again when the displayed language changed since the last copy', async () => {
    const { d, store } = deps({}, { [languageSyncKey('u1')]: 'en' });
    expect(await syncPreferredLanguage('u1', 'fr', d)).toBe(true);
    expect(store[languageSyncKey('u1')]).toBe('fr');
  });

  it('notes nothing when the write does not land (offline or refused), so the next start tries again', async () => {
    const { d, store } = deps({ updateLanguage: vi.fn(async () => false) });
    expect(await syncPreferredLanguage('u1', 'fr', d)).toBe(false);
    expect(store[languageSyncKey('u1')]).toBeUndefined();
  });

  it('never throws, whatever fails', async () => {
    const { d } = deps({ getItem: vi.fn(async () => { throw new Error('storage'); }) });
    await expect(syncPreferredLanguage('u1', 'fr', d)).resolves.toBe(false);
    const { d: d2 } = deps({ updateLanguage: vi.fn(async () => { throw new Error('network'); }) });
    await expect(syncPreferredLanguage('u1', 'en', d2)).resolves.toBe(false);
  });

  it('keeps one note per member, so a second account on the same phone is synced on its own', async () => {
    const { d } = deps({}, { [languageSyncKey('u1')]: 'fr' });
    expect(await syncPreferredLanguage('u2', 'fr', d)).toBe(true);
  });
});

// Wiring pins (no render harness for the root layout): the sync is scheduled when idle, only for a signed-in member, and the Profile switcher notes its own write.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

describe('language sync wiring', () => {
  const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

  it('the root layout runs it when idle, for a signed-in member only, and cancels it on cleanup', () => {
    const layout = read('../app/_layout.tsx');
    expect(layout).toContain('if (!sessionUserId || isLoading) return;');
    expect(layout).toContain('requestIdleCallback(() => {');
    expect(layout).toContain('syncPreferredLanguage(sessionUserId, language, defaultLanguageSyncDeps)');
    expect(layout).toContain('cancelIdleCallback(task)');
  });

  it('the Profile language switcher notes its successful write', () => {
    expect(read('../app/(tabs)/profile.tsx')).toContain('void noteLanguageSynced(userId, code);');
  });

  it('the pure module imports no storage and no Supabase client', () => {
    const pure = read('./languageSync.ts');
    expect(pure).not.toMatch(/from '@\/lib\/supabase'|async-storage/);
  });
});
