import { ANALYTICS_EVENT, logProgressEntrySchema } from '@gymos/types';

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

  const { error } = await supabase.from('progress_entries').insert({
    member_id: current.memberId,
    gym_id: current.gymId,
    weight_kg: parsed.data.weightKg,
    waist_cm: parsed.data.waistCm,
    chest_cm: parsed.data.chestCm,
    hips_cm: parsed.data.hipsCm,
    arms_cm: parsed.data.armsCm,
    thighs_cm: parsed.data.thighsCm,
    photo_path: photoPath,
    note: parsed.data.note,
    client_entry_id: clientEntryId,
  });

  if (error) {
    if (error.code === '23505') {
      const { data: existing } = await supabase
        .from('progress_entries')
        .select('id')
        .eq('client_entry_id', clientEntryId)
        .maybeSingle();
      if (!existing) return { success: false };
    } else {
      return { success: false };
    }
  }

  captureEvent(ANALYTICS_EVENT.PROGRESS_ENTRY_LOGGED, analyticsPayload(fields, current.gymId, false));
  return { success: true };
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
      // rather than insert a row with a dangling/missing photo_path.
      return;
    }
  }

  const { error } = await supabase.from('progress_entries').insert({
    member_id: memberId,
    gym_id: gymId,
    weight_kg: record.weightKg,
    waist_cm: record.waistCm,
    chest_cm: record.chestCm,
    hips_cm: record.hipsCm,
    arms_cm: record.armsCm,
    thighs_cm: record.thighsCm,
    photo_path: photoPath,
    note: record.note,
    client_entry_id: record.id,
    logged_at: record.loggedAt,
  });

  if (!error || error.code === '23505') {
    // Success, or already-exists (unique-violation replay) -- it's already
    // synced under a different attempt either way.
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
  // Any other server-side rejection is treated the same as check-in's
  // "non-retryable" branch would be, but progress_entries has no such
  // business-rule rejection today (no capacity check, no invariant beyond
  // ownership) -- left queued for a future sync attempt.
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
