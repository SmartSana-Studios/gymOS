import { beforeEach, describe, expect, it, vi } from 'vitest';

const { store, storage } = vi.hoisted(() => {
  const store = new Map<string, string>();
  const storage = {
    getItem: vi.fn(async (k: string) => store.get(k) ?? null),
    setItem: vi.fn(async (k: string, v: string) => {
      store.set(k, v);
    }),
  };
  return { store, storage };
});
vi.mock('@react-native-async-storage/async-storage', () => ({ default: storage }));

import { readSeenGrants, recordSeenGrants } from './loyaltySeen';

const KEY = 'gymos.loyaltySeenGrants.v1.u.g';

beforeEach(() => {
  store.clear();
  storage.getItem.mockClear();
  storage.setItem.mockClear();
});

describe('readSeenGrants', () => {
  it('empty when nothing is stored', async () => {
    expect(await readSeenGrants('u.g')).toEqual(new Set());
  });

  it('treats a corrupt value as empty so it can self-heal', async () => {
    store.set(KEY, '{not json');
    expect(await readSeenGrants('u.g')).toEqual(new Set());
    store.set(KEY, '{"a":1}');
    expect(await readSeenGrants('u.g')).toEqual(new Set());
  });

  it('null when storage itself fails', async () => {
    storage.getItem.mockRejectedValueOnce(new Error('disk'));
    expect(await readSeenGrants('u.g')).toBeNull();
  });
});

describe('recordSeenGrants', () => {
  it('merges without duplicates, scoped by key', async () => {
    await recordSeenGrants('u.g', ['a', 'b']);
    await recordSeenGrants('u.g', ['b', 'c']);
    expect(JSON.parse(store.get(KEY)!)).toEqual(['a', 'b', 'c']);
    expect(await readSeenGrants('other.g')).toEqual(new Set());
  });

  it('keeps the newest 200 ids', async () => {
    const ids = Array.from({ length: 205 }, (_, i) => `id${i}`);
    await recordSeenGrants('u.g', ids);
    const saved = JSON.parse(store.get(KEY)!) as string[];
    expect(saved).toHaveLength(200);
    expect(saved[199]).toBe('id204');
  });

  it('false and no write when storage cannot be read or written', async () => {
    storage.getItem.mockRejectedValueOnce(new Error('disk'));
    expect(await recordSeenGrants('u.g', ['a'])).toBe(false);
    expect(storage.setItem).not.toHaveBeenCalled();
    storage.setItem.mockRejectedValueOnce(new Error('full'));
    expect(await recordSeenGrants('u.g', ['a'])).toBe(false);
  });
});
