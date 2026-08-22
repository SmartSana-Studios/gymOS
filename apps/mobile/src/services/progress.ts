import {
  ANALYTICS_EVENT,
  deleteProgressEntrySchema,
  logProgressEntrySchema,
  updateProgressPhotoSharingSchema,
  type MemberGoalInput,
} from '@gymos/types';

import { captureEvent } from '@/lib/analytics';
import {
  deleteOfflineProgressEntry,
  getOfflineProgressEntries,
  insertOfflineProgressEntry,
  type OfflineProgressEntry,
} from '@/lib/sqlite';
import { uploadProgressPhoto } from '@/lib/photo-upload';
import { supabase } from '@/lib/supabase';

/** Fields a caller (LogEntrySheet) supplies -- any subset, `photoUri` is a
 * local on-device file URI (not yet uploaded), never a bucket path. Mirrors
 * `logProgressEntrySchema`'s numeric/note fields; `clientEntryId` is
 * generated internally by this module, not supplied by the caller. */
export interface ProgressEntryFields {
  weightKg?: number | null;
  waistCm?: number | null;
  chestCm?: number | null;
  hipsCm?: number | null;
  armsCm?: number | null;
  thighsCm?: number | null;
  note?: string | null;
  photoUri?: string | null;
}

export interface LogProgressEntryResult {
  success: boolean;
  /** Set when the entry itself was saved but its photo upsert failed
   * (Review finding) -- the entry is never silently orphaned by reporting
   * a persisted write as a total failure; no UI reads this yet. */
  photoFailed?: boolean;
}

/** Resolves the caller's own current member_id/gym_id -- same
 * most-recently-created, non-deactivated tie-break the JWT claims hook uses
 * (0009_auth_hook_gym_claims.sql), matching onboarding/plan.tsx's and
 * (tabs)/profile.tsx's identical resolution query. Exported so
 * onboarding/body-profile.tsx can reuse it too (Review finding) instead of
 * writing to `members` unscoped by id. */
export async function getCurrentMember(userId: string): Promise<{ memberId: string; gymId: string } | null> {
  const { data, error } = await supabase
    .from('members')
    .select('id, gym_id')
    .eq('user_id', userId)
    .is('deactivated_at', null)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(1)
    .single();

  if (error || !data) return null;
  return { memberId: data.id, gymId: data.gym_id };
}

function analyticsPayload(fields: ProgressEntryFields, gymId: string, loggedOffline: boolean) {
  const measurementCount = [fields.waistCm, fields.chestCm, fields.hipsCm, fields.armsCm, fields.thighsCm].filter(
    (value) => value != null,
  ).length;
  return {
    gymId,
    hasWeight: fields.weightKg != null,
    measurementCount,
    hasPhoto: fields.photoUri != null,
    hasNote: fields.note != null,
    loggedOffline,
  };
}

/** Story 10.1 AC #3: the online-immediate path. `clientEntryId` is supplied
 * by the caller (LogEntrySheet) and stays stable across retries of the same
 * submission (Review finding -- generating a fresh id per call here used to
 * make the unique-violation fallback below unreachable, since a genuine
 * retry after a timeout would never collide). Validates the assembled
 * payload via `logProgressEntrySchema` *before* uploading any photo (Review
 * finding -- validating after upload could leave an orphaned Storage
 * object on a subsequent validation failure), then uploads the photo (if
 * present) and inserts. On a unique-violation (Postgres 23505,
 * `client_entry_id` conflict -- the idempotent-replay case), confirms the
 * already-inserted row exists and treats it as success (Task 5) instead of
 * surfacing an error. No `SECURITY DEFINER` RPC -- see the story's Dev
 * Notes ("Why a Plain RLS Insert, Not a `check_in()`-Style RPC") for why
 * this diverges from check-in's precedent. */
export async function logProgressEntry(
  fields: ProgressEntryFields,
  clientEntryId: string,
): Promise<LogProgressEntryResult> {
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user.id;
  if (!userId) return { success: false };

  const current = await getCurrentMember(userId);
  if (!current) return { success: false };

  // `photoPath` stands in for the not-yet-uploaded `fields.photoUri` here --
  // only its presence/absence and length matter for this validation pass;
  // the real bucket path (once uploaded) is inserted separately below.
  const parsed = logProgressEntrySchema.safeParse({
    weightKg: fields.weightKg ?? null,
    waistCm: fields.waistCm ?? null,
    chestCm: fields.chestCm ?? null,
    hipsCm: fields.hipsCm ?? null,
    armsCm: fields.armsCm ?? null,
    thighsCm: fields.thighsCm ?? null,
    photoPath: fields.photoUri ?? null,
    note: fields.note ?? null,
    clientEntryId,
  });
  if (!parsed.success) return { success: false };

  let photoPath: string | null = null;
  if (fields.photoUri) {
    photoPath = await uploadProgressPhoto(userId, clientEntryId, fields.photoUri);
    if (!photoPath) return { success: false };
  }

  const { data: inserted, error } = await supabase
    .from('progress_entries')
    .insert({
      member_id: current.memberId,
      gym_id: current.gymId,
      weight_kg: parsed.data.weightKg,
      waist_cm: parsed.data.waistCm,
      chest_cm: parsed.data.chestCm,
      hips_cm: parsed.data.hipsCm,
      arms_cm: parsed.data.armsCm,
      thighs_cm: parsed.data.thighsCm,
      note: parsed.data.note,
      client_entry_id: clientEntryId,
    })
    .select('id')
    .single();

  let entryId: string | null = inserted?.id ?? null;

  if (error) {
    if (error.code === '23505') {
      const { data: existing } = await supabase
        .from('progress_entries')
        .select('id')
        .eq('client_entry_id', clientEntryId)
        .maybeSingle();
      if (!existing) return { success: false };
      entryId = existing.id;
    } else {
      return { success: false };
    }
  }

  // Story 10.2: the photo now lives in its own progress_photos table, not a
  // column on progress_entries. The unique index on progress_entry_id
  // (0067) makes this upsert idempotent on retry -- the same reason no
  // transaction-owning RPC is needed for the two-step write (see the
  // story's Dev Notes, "Why a Plain RLS Update, Not an RPC (Again)").
  let photoFailed = false;
  if (photoPath && entryId) {
    const { error: photoError } = await supabase.from('progress_photos').upsert(
      {
        gym_id: current.gymId,
        member_id: current.memberId,
        progress_entry_id: entryId,
        photo_path: photoPath,
      },
      { onConflict: 'progress_entry_id' },
    );
    if (photoError) photoFailed = true;
  }

  captureEvent(ANALYTICS_EVENT.PROGRESS_ENTRY_LOGGED, analyticsPayload(fields, current.gymId, false));
  return photoFailed ? { success: true, photoFailed: true } : { success: true };
}

/** Story 10.1 AC #5: queues an offline progress entry locally and returns
 * immediately -- no network call -- mirroring `checkin.ts`'s
 * `queueOfflineCheckIn()` shape exactly. `clientEntryId` is supplied by the
 * caller (LogEntrySheet) and stays stable across retries of the same
 * submission, matching `logProgressEntry`'s online path. `photoUri` (if
 * present) is queued as-is; the actual Storage upload happens during sync.
 * Validated via `logProgressEntrySchema` before ever reaching SQLite
 * (Review finding -- this path used to skip validation entirely, unlike
 * the online path, letting out-of-range values reach the DB on sync since
 * there's no DB CHECK constraint by design). */
export async function queueOfflineProgressEntry(
  fields: ProgressEntryFields,
  clientEntryId: string,
): Promise<{ success: true; id: string } | { success: false }> {
  const parsed = logProgressEntrySchema.safeParse({
    weightKg: fields.weightKg ?? null,
    waistCm: fields.waistCm ?? null,
    chestCm: fields.chestCm ?? null,
    hipsCm: fields.hipsCm ?? null,
    armsCm: fields.armsCm ?? null,
    thighsCm: fields.thighsCm ?? null,
    photoPath: fields.photoUri ?? null,
    note: fields.note ?? null,
    clientEntryId,
  });
  if (!parsed.success) return { success: false };

  const loggedAt = new Date().toISOString();
  await insertOfflineProgressEntry({
    id: clientEntryId,
    weightKg: parsed.data.weightKg ?? null,
    waistCm: parsed.data.waistCm ?? null,
    chestCm: parsed.data.chestCm ?? null,
    hipsCm: parsed.data.hipsCm ?? null,
    armsCm: parsed.data.armsCm ?? null,
    thighsCm: parsed.data.thighsCm ?? null,
    note: parsed.data.note ?? null,
    photoLocalUri: fields.photoUri ?? null,
    loggedAt,
  });
  return { success: true, id: clientEntryId };
}

async function syncOneProgressEntry(record: OfflineProgressEntry, userId: string, memberId: string, gymId: string) {
  let photoPath: string | null = null;
  if (record.photoLocalUri) {
    photoPath = await uploadProgressPhoto(userId, record.id, record.photoLocalUri);
    if (!photoPath) {
      // Photo upload failed on a flaky connection -- leave the row queued
      // rather than sync an entry this sync pass can't yet attach a photo to.
      return;
    }
  }

  const { data: inserted, error } = await supabase
    .from('progress_entries')
    .insert({
      member_id: memberId,
      gym_id: gymId,
      weight_kg: record.weightKg,
      waist_cm: record.waistCm,
      chest_cm: record.chestCm,
      hips_cm: record.hipsCm,
      arms_cm: record.armsCm,
      thighs_cm: record.thighsCm,
      note: record.note,
      client_entry_id: record.id,
      logged_at: record.loggedAt,
    })
    .select('id')
    .single();

  let entryId: string | null = inserted?.id ?? null;

  if (error) {
    if (error.code === '23505') {
      // Already-exists (unique-violation replay) -- resolve the entry id
      // synced under a different attempt so the photo upsert below can
      // still target it.
      const { data: existing } = await supabase
        .from('progress_entries')
        .select('id')
        .eq('client_entry_id', record.id)
        .maybeSingle();
      entryId = existing?.id ?? null;
    } else {
      // Any other server-side rejection is treated the same as check-in's
      // "non-retryable" branch would be, but progress_entries has no such
      // business-rule rejection today (no capacity check, no invariant
      // beyond ownership) -- left queued for a future sync attempt.
      return;
    }
  }

  if (photoPath && entryId) {
    const { error: photoError } = await supabase.from('progress_photos').upsert(
      { gym_id: gymId, member_id: memberId, progress_entry_id: entryId, photo_path: photoPath },
      { onConflict: 'progress_entry_id' },
    );
    if (photoError) {
      // Entry is synced but the photo row isn't -- leave the offline
      // record queued so a retry re-uploads (upsert: true, same path) and
      // re-attempts this upsert, rather than losing the photo association.
      return;
    }
  } else if (photoPath && !entryId) {
    // Entry insert failed with a 23505 whose existing-row lookup somehow
    // came back empty -- leave queued rather than orphan the photo upload.
    return;
  }

  await deleteOfflineProgressEntry(record.id);
  captureEvent(
    ANALYTICS_EVENT.PROGRESS_ENTRY_LOGGED,
    analyticsPayload(
      {
        weightKg: record.weightKg,
        waistCm: record.waistCm,
        chestCm: record.chestCm,
        hipsCm: record.hipsCm,
        armsCm: record.armsCm,
        thighsCm: record.thighsCm,
        note: record.note,
        photoUri: record.photoLocalUri,
      },
      gymId,
      true,
    ),
  );
}

/** Story 10.1 AC #5: replays every queued offline progress entry,
 * oldest-first, mirroring `syncPendingCheckIns()`'s per-record
 * independent-outcome loop exactly -- one record's outcome must never stop
 * processing the rest of the batch. */
export async function syncPendingProgressEntries(): Promise<void> {
  let pending;
  try {
    pending = await getOfflineProgressEntries();
  } catch (err) {
    console.error('[offline-sync] failed to read the local progress-entry queue', err);
    return;
  }
  if (pending.length === 0) return;

  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user.id;
  if (!userId) return;

  const current = await getCurrentMember(userId);
  if (!current) return;

  for (const record of pending) {
    try {
      await syncOneProgressEntry(record, userId, current.memberId, current.gymId);
    } catch (err) {
      // Network/thrown exception: leave queued, retried on the next sync pass.
      console.error('[offline-sync] progress-entry insert failed, record left queued for retry', err);
    }
  }
}

/** Story 10.2: the per-photo sharing-toggle write path -- a pure
 * ownership-gated column flip (see the story's Dev Notes, "Why a Plain RLS
 * Update, Not an RPC (Again)"). No UI calls this yet (the story's own Scope
 * Boundary) -- Story 10.3 is the first caller, once its photo detail view
 * exists. Returns the raw `{ data, error }` shape (AD-9) rather than this
 * file's own typed-result-union convention -- a 0-row update (RLS-denied,
 * or the photo was already deleted by a cascade) is a normal, expected
 * outcome here, never a thrown exception. */
export async function setProgressPhotoSharing(photoId: string, shared: boolean) {
  const parsed = updateProgressPhotoSharingSchema.safeParse({ photoId, shared });
  if (!parsed.success) {
    return { data: null, error: parsed.error };
  }

  const result = await supabase
    .from('progress_photos')
    .update({ shared_with_coach: parsed.data.shared })
    .eq('id', parsed.data.photoId)
    .select()
    .single();

  // Review finding: keep the in-memory cache consistent with the write --
  // otherwise the Progress screen's photo-grid lock icon can show stale
  // state after navigating back from this toggle.
  if (!result.error && cachedProgressPayload) {
    cachedProgressPayload = {
      ...cachedProgressPayload,
      data: {
        ...cachedProgressPayload.data,
        photos: cachedProgressPayload.data.photos.map((photo) =>
          photo.id === parsed.data.photoId ? { ...photo, sharedWithCoach: parsed.data.shared } : photo,
        ),
      },
    };
  }

  return result;
}

export interface ProgressEntryRow {
  id: string;
  weightKg: number | null;
  waistCm: number | null;
  chestCm: number | null;
  hipsCm: number | null;
  armsCm: number | null;
  thighsCm: number | null;
  note: string | null;
  loggedAt: string;
}

export interface ProgressPhotoRow {
  id: string;
  photoPath: string;
  sharedWithCoach: boolean;
  progressEntryId: string;
  createdAt: string;
}

export interface ProgressScreenData {
  goal: MemberGoalInput | null;
  startingWeightKg: number | null;
  entries: ProgressEntryRow[];
  photos: ProgressPhotoRow[];
}

// Story 10.3: mirrors use-gym-accent-color.tsx's exact module-level-cache
// shape -- session-lifetime only, no TTL/expiry, cleared only on app
// restart (or an explicit sign-out, see `clearCachedProgressPayload`). Read
// by the Progress screen when a fresh fetch fails or `isConnected === false`
// (AC #3); this codebase has no persistent cross-app-restart read cache
// anywhere, see the story's Dev Notes ("What 'Local Cache' Means Here").
// Keyed by memberId (Review finding) -- an un-keyed cache would survive a
// same-device member switch and could briefly leak one member's weight/
// photos to another before a fresh fetch overwrites it.
let cachedProgressPayload: { memberId: string; data: ProgressScreenData } | null = null;

export function getCachedProgressPayload(memberId: string): ProgressScreenData | null {
  return cachedProgressPayload?.memberId === memberId ? cachedProgressPayload.data : null;
}

/** Review finding: called from the sign-out flow so a subsequent sign-in as
 * a different member on the same device never sees a stale cache. */
export function clearCachedProgressPayload(): void {
  cachedProgressPayload = null;
}

const PROGRESS_PHOTOS_LIMIT = 60;

/** Story 10.3 Task 3: the Progress screen's single on-mount fetch --
 * member's goal/starting weight, all of their own progress entries
 * (oldest-first, for the chart), and up to their most recent 60 photos
 * (reverse-chronological, no pagination UI at pilot scale, mirrors
 * `history/index.tsx`'s PAGE_SIZE precedent in spirit only). Soft-deleted
 * entries are filtered client-side (`deactivated_at === null`) -- RLS's
 * `self_read_own_progress_entries` deliberately does not hide them from
 * their own owner (Story 10.2's documented precedent), so this is not a bug
 * to "fix" at the RLS layer. On success, refreshes the in-memory cache. */
export async function loadProgressScreenData(
  memberId: string,
): Promise<{ data: ProgressScreenData | null; error: unknown }> {
  const [memberResult, entriesResult, photosResult] = await Promise.all([
    supabase.from('members').select('goal, starting_weight_kg').eq('id', memberId).single(),
    supabase
      .from('progress_entries')
      .select('id, weight_kg, waist_cm, chest_cm, hips_cm, arms_cm, thighs_cm, note, logged_at, deactivated_at')
      .eq('member_id', memberId)
      .order('logged_at', { ascending: true }),
    supabase
      .from('progress_photos')
      .select('id, photo_path, shared_with_coach, progress_entry_id, created_at')
      .eq('member_id', memberId)
      .order('created_at', { ascending: false })
      .limit(PROGRESS_PHOTOS_LIMIT),
  ]);

  if (memberResult.error || !memberResult.data) return { data: null, error: memberResult.error };

  // Review finding: entries/photos are two independent, secondary reads --
  // a transient failure on either one alone shouldn't block the whole
  // screen (including the weight chart, which only needs entries). Degrade
  // to an empty list for whichever query failed instead of failing the
  // entire payload.
  const entriesRows = entriesResult.error || !entriesResult.data ? [] : entriesResult.data;
  const photosRows = photosResult.error || !photosResult.data ? [] : photosResult.data;

  const data: ProgressScreenData = {
    goal: (memberResult.data.goal as MemberGoalInput | null) ?? null,
    startingWeightKg: memberResult.data.starting_weight_kg,
    entries: entriesRows
      .filter((row) => row.deactivated_at === null)
      .map((row) => ({
        id: row.id,
        weightKg: row.weight_kg,
        waistCm: row.waist_cm,
        chestCm: row.chest_cm,
        hipsCm: row.hips_cm,
        armsCm: row.arms_cm,
        thighsCm: row.thighs_cm,
        note: row.note,
        loggedAt: row.logged_at,
      })),
    photos: photosRows.map((row) => ({
      id: row.id,
      photoPath: row.photo_path,
      sharedWithCoach: row.shared_with_coach,
      progressEntryId: row.progress_entry_id,
      createdAt: row.created_at,
    })),
  };

  cachedProgressPayload = { memberId, data };
  return { data, error: null };
}

/** Story 10.3: soft-deletes an entry (`deactivated_at`), resolving Story
 * 10.1 AC #4's deferred delete affordance. Same zero-row-update guard
 * discipline as `profile.tsx`'s `handleSaveProfile` -- a 0-row result
 * (already-deleted, or an RLS-denied cross-member id, which this screen's
 * own UI can't actually produce) is a failure to surface, not a silent
 * success, even though `error` is null under PostgREST for a 0-row update. */
export async function deleteProgressEntry(entryId: string) {
  const parsed = deleteProgressEntrySchema.safeParse({ entryId });
  if (!parsed.success) {
    return { data: null, error: parsed.error };
  }

  const { data, error } = await supabase
    .from('progress_entries')
    .update({ deactivated_at: new Date().toISOString() })
    .eq('id', parsed.data.entryId)
    .select('id');

  if (error) return { data: null, error };
  if (!data || data.length === 0) return { data: null, error: new Error('No matching progress entry to delete') };

  // Review finding: keep the in-memory cache consistent with the write --
  // otherwise a later cache-fallback read (offline, or a stale online read)
  // can resurrect an entry that was just deleted.
  if (cachedProgressPayload) {
    cachedProgressPayload = {
      ...cachedProgressPayload,
      data: {
        ...cachedProgressPayload.data,
        entries: cachedProgressPayload.data.entries.filter((entry) => entry.id !== entryId),
      },
    };
  }

  return { data, error: null };
}
