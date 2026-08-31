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

/** Story 10.1: the offline-queue intent for a progress entry -- every
 * loggable field as a nullable column, plus `photoLocalUri` (the on-device
 * file URI before upload). The actual Storage upload happens during sync,
 * not before -- this row queues the intent to upload+insert. */
export interface OfflineProgressEntry {
  id: string;
  weightKg: number | null;
  waistCm: number | null;
  chestCm: number | null;
  hipsCm: number | null;
  armsCm: number | null;
  thighsCm: number | null;
  note: string | null;
  photoLocalUri: string | null;
  loggedAt: string;
}

/** Story 13.3: the offline-queue intent for a workout-plan exercise
 * completion. `id` is the client_completion_id, doubling as the
 * idempotency key -- same convention as the other two tables. */
export interface OfflineWorkoutCompletion {
  id: string;
  planId: string;
  exerciseId: string;
  completedAt: string;
}

let dbPromise: ReturnType<typeof SQLite.openDatabaseAsync> | null = null;

function getDb() {
  if (!dbPromise) {
    dbPromise = SQLite.openDatabaseAsync('gymos.db')
      .then(async (db) => {
        await db.execAsync(
          'CREATE TABLE IF NOT EXISTS offline_check_ins (id TEXT PRIMARY KEY, scanned_at TEXT NOT NULL)',
        );
        // Story 10.1: second queue-item type in the same DB/connection (AD-23
        // requires reusing the same infra, one queue-item type per domain) --
        // `id` is the client_entry_id, doubling as the idempotency key exactly
        // like offline_check_ins.id doubles as client_scan_id.
        await db.execAsync(
          `CREATE TABLE IF NOT EXISTS offline_progress_entries (
            id TEXT PRIMARY KEY,
            weight_kg REAL,
            waist_cm REAL,
            chest_cm REAL,
            hips_cm REAL,
            arms_cm REAL,
            thighs_cm REAL,
            note TEXT,
            photo_local_uri TEXT,
            logged_at TEXT NOT NULL
          )`,
        );
        // Story 13.3: third queue-item type in the same DB/connection
        // (AD-23 requires reusing the same infra, one queue-item type per
        // domain) -- id is the client_completion_id, doubling as the
        // idempotency key exactly like the other two tables' id columns.
        await db.execAsync(
          `CREATE TABLE IF NOT EXISTS offline_workout_completions (
            id TEXT PRIMARY KEY,
            plan_id TEXT NOT NULL,
            exercise_id TEXT NOT NULL,
            completed_at TEXT NOT NULL
          )`,
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

interface OfflineProgressEntryRow {
  id: string;
  weight_kg: number | null;
  waist_cm: number | null;
  chest_cm: number | null;
  hips_cm: number | null;
  arms_cm: number | null;
  thighs_cm: number | null;
  note: string | null;
  photo_local_uri: string | null;
  logged_at: string;
}

function toOfflineProgressEntry(row: OfflineProgressEntryRow): OfflineProgressEntry {
  return {
    id: row.id,
    weightKg: row.weight_kg,
    waistCm: row.waist_cm,
    chestCm: row.chest_cm,
    hipsCm: row.hips_cm,
    armsCm: row.arms_cm,
    thighsCm: row.thighs_cm,
    note: row.note,
    photoLocalUri: row.photo_local_uri,
    loggedAt: row.logged_at,
  };
}

export async function insertOfflineProgressEntry(entry: OfflineProgressEntry): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO offline_progress_entries
      (id, weight_kg, waist_cm, chest_cm, hips_cm, arms_cm, thighs_cm, note, photo_local_uri, logged_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    entry.id,
    entry.weightKg,
    entry.waistCm,
    entry.chestCm,
    entry.hipsCm,
    entry.armsCm,
    entry.thighsCm,
    entry.note,
    entry.photoLocalUri,
    entry.loggedAt,
  );
}

export async function getOfflineProgressEntries(): Promise<OfflineProgressEntry[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<OfflineProgressEntryRow>(
    'SELECT * FROM offline_progress_entries ORDER BY logged_at ASC',
  );
  return rows.map(toOfflineProgressEntry);
}

export async function deleteOfflineProgressEntry(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM offline_progress_entries WHERE id = ?', id);
}

export async function countOfflineProgressEntries(): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ count: number }>('SELECT COUNT(*) as count FROM offline_progress_entries');
  return row?.count ?? 0;
}

interface OfflineWorkoutCompletionRow {
  id: string;
  plan_id: string;
  exercise_id: string;
  completed_at: string;
}

function toOfflineWorkoutCompletion(row: OfflineWorkoutCompletionRow): OfflineWorkoutCompletion {
  return {
    id: row.id,
    planId: row.plan_id,
    exerciseId: row.exercise_id,
    completedAt: row.completed_at,
  };
}

export async function insertOfflineWorkoutCompletion(completion: OfflineWorkoutCompletion): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'INSERT INTO offline_workout_completions (id, plan_id, exercise_id, completed_at) VALUES (?, ?, ?, ?)',
    completion.id,
    completion.planId,
    completion.exerciseId,
    completion.completedAt,
  );
}

export async function getOfflineWorkoutCompletions(): Promise<OfflineWorkoutCompletion[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<OfflineWorkoutCompletionRow>(
    'SELECT * FROM offline_workout_completions ORDER BY completed_at ASC',
  );
  return rows.map(toOfflineWorkoutCompletion);
}

export async function deleteOfflineWorkoutCompletion(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM offline_workout_completions WHERE id = ?', id);
}

export async function countOfflineWorkoutCompletions(): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ count: number }>('SELECT COUNT(*) as count FROM offline_workout_completions');
  return row?.count ?? 0;
}
