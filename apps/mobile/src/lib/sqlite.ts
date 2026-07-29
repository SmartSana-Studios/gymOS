import * as SQLite from 'expo-sqlite';

/** Story 3.9: local offline check-in queue (NFR-006/FR-061) -- the only
 * client-side persistence this codebase uses anywhere. One table, no
 * relations, no migrations of its own (Scope Note #1): a row's mere
 * presence *is* "pending sync"; a successful sync deletes it -- no
 * `synced` flag or retry-count column needed. This is the only file that
 * imports `expo-sqlite` directly, matching this app's existing "one file
 * owns the low-level client" boundary discipline (`lib/supabase.ts` for
 * `@supabase/supabase-js`). */

export interface OfflineCheckIn {
  id: string;
  scannedAt: string;
}

let dbPromise: ReturnType<typeof SQLite.openDatabaseAsync> | null = null;

function getDb() {
  if (!dbPromise) {
    dbPromise = SQLite.openDatabaseAsync('gymos.db')
      .then(async (db) => {
        await db.execAsync(
          'CREATE TABLE IF NOT EXISTS offline_check_ins (id TEXT PRIMARY KEY, scanned_at TEXT NOT NULL)',
        );
        return db;
      })
      .catch((err) => {
        // Don't cache a rejected promise -- the next call should retry the open
        // instead of failing forever for the rest of the app session.
        dbPromise = null;
        throw err;
      });
  }
  return dbPromise;
}

export async function insertOfflineCheckIn(id: string, scannedAt: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('INSERT INTO offline_check_ins (id, scanned_at) VALUES (?, ?)', id, scannedAt);
}

export async function getOfflineCheckIns(): Promise<OfflineCheckIn[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ id: string; scanned_at: string }>(
    'SELECT id, scanned_at FROM offline_check_ins ORDER BY scanned_at ASC',
  );
  return rows.map((row) => ({ id: row.id, scannedAt: row.scanned_at }));
}

export async function deleteOfflineCheckIn(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM offline_check_ins WHERE id = ?', id);
}

export async function countOfflineCheckIns(): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ count: number }>('SELECT COUNT(*) as count FROM offline_check_ins');
  return row?.count ?? 0;
}
