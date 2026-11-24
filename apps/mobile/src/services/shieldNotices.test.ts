import { beforeEach, describe, expect, it, vi } from 'vitest';

const { store, storage } = vi.hoisted(() => {
  const store = new Map<string, string>();
  const storage = {
    getItem: vi.fn(async (k: string) => store.get(k) ?? null),
    setItem: vi.fn(async (k: string, v: string) => {
      store.set(k, v);
    }),
    getAllKeys: vi.fn(async () => [...store.keys()]),
    multiRemove: vi.fn(async (keys: string[]) => {
      for (const k of keys) store.delete(k);
    }),
  };
  return { store, storage };
});
vi.mock('@react-native-async-storage/async-storage', () => ({ default: storage }));

import { clearShieldNotices, MAX_IDS, readDismissed, recordDismissed, shieldNoticesKey } from './shieldNotices';

beforeEach(() => {
  store.clear();
  storage.getItem.mockClear();
  storage.setItem.mockClear();
});

describe('shield notice store', () => {
  it('is keyed per user and gym', () => {
    expect(shieldNoticesKey('u1', 'g1')).toBe('gymos.shieldNotices.v1.u1.g1');
  });

  it('reads empty for a new member and records ids per user and gym', async () => {
    expect(await readDismissed('u1', 'g1')).toEqual(new Set());
    expect(await recordDismissed('u1', 'g1', 'saved:2026-11-16')).toBe(true);
    expect(await readDismissed('u1', 'g1')).toEqual(new Set(['saved:2026-11-16']));
    expect(await readDismissed('u1', 'g2')).toEqual(new Set());
    expect(await readDismissed('u2', 'g1')).toEqual(new Set());
  });

  it('recording an id twice stores it once', async () => {
    await recordDismissed('u1', 'g1', 'a');
    await recordDismissed('u1', 'g1', 'a');
    expect(JSON.parse(store.get(shieldNoticesKey('u1', 'g1')) ?? '[]')).toEqual(['a']);
  });

  it('two concurrent recordDismissed calls keep both ids (writes are serialised)', async () => {
    // A slow read makes the second call read the old set unless it waits for the first write.
    storage.getItem.mockImplementationOnce(async (k: string) => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return store.get(k) ?? null;
    });
    const [a, b] = await Promise.all([recordDismissed('u1', 'g1', 'saved:2026-11-16'), recordDismissed('u1', 'g1', 'restored:2026-11-02')]);
    expect(a).toBe(true);
    expect(b).toBe(true);
    expect(await readDismissed('u1', 'g1')).toEqual(new Set(['saved:2026-11-16', 'restored:2026-11-02']));
    // a failed write does not block the ones queued behind it
    storage.setItem.mockRejectedValueOnce(new Error('disk full'));
    expect(await recordDismissed('u1', 'g1', 'x')).toBe(false);
    expect(await recordDismissed('u1', 'g1', 'y')).toBe(true);
  });

  it('keeps the newest 50 ids', async () => {
    for (let i = 0; i < MAX_IDS + 5; i++) await recordDismissed('u1', 'g1', `id${i}`);
    const ids = JSON.parse(store.get(shieldNoticesKey('u1', 'g1')) ?? '[]') as string[];
    expect(ids).toHaveLength(MAX_IDS);
    expect(ids[ids.length - 1]).toBe(`id${MAX_IDS + 4}`);
    expect(ids).not.toContain('id0');
  });

  it('a corrupt value reads as empty and the next write replaces it', async () => {
    store.set(shieldNoticesKey('u1', 'g1'), '{not json');
    expect(await readDismissed('u1', 'g1')).toEqual(new Set());
    store.set(shieldNoticesKey('u1', 'g1'), '{"a":1}');
    expect(await readDismissed('u1', 'g1')).toEqual(new Set());
    expect(await recordDismissed('u1', 'g1', 'x')).toBe(true);
    expect(await readDismissed('u1', 'g1')).toEqual(new Set(['x']));
  });

  it('fails closed: a storage error reads as null, and nothing is overwritten', async () => {
    storage.getItem.mockRejectedValueOnce(new Error('disk'));
    expect(await readDismissed('u1', 'g1')).toBeNull();
    storage.getItem.mockRejectedValueOnce(new Error('disk'));
    expect(await recordDismissed('u1', 'g1', 'x')).toBe(false);
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('a failed write reports false', async () => {
    storage.setItem.mockRejectedValueOnce(new Error('full'));
    expect(await recordDismissed('u1', 'g1', 'x')).toBe(false);
  });

  it('sign-out clears every member record and nothing else, and never throws', async () => {
    await recordDismissed('u1', 'g1', 'a');
    await recordDismissed('u2', 'g2', 'b');
    store.set('gymos.celebration.v1.u1.g1', 'keep');
    await clearShieldNotices();
    expect([...store.keys()]).toEqual(['gymos.celebration.v1.u1.g1']);
    storage.getAllKeys.mockRejectedValueOnce(new Error('boom'));
    await expect(clearShieldNotices()).resolves.toBeUndefined();
  });
});
