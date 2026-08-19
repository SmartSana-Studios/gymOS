import { createClient } from "@/lib/supabase/server";
import { type AppError } from "@gymos/types";
import { mapAndLog } from "@/services/session";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getServerTranslation } from "@/lib/i18n/get-server-translation";

/** Shared by every "0 rows affected" (RLS-denied) / "no gym_id claim" branch
 * in this file -- same discipline as plans.ts's planNotFoundError /
 * coaches.ts's coachNotFoundError: `context` is logged server-side only,
 * never shown to the caller. */
async function classNotFoundError(context: string): Promise<AppError> {
  console.warn(`[classes] resolved to not_found: ${context}`);
  const { t } = await getServerTranslation(await getRequestLocale());
  return { code: "not_found", message: t("classes.errors.classNotFound") };
}

/** Every function in this file needs the caller's own `gym_id`, read from
 * claims -- copied verbatim from plans.ts/coaches.ts's own (unexported)
 * helper rather than reaching across service files, matching this app's
 * established per-file-copy discipline. */
async function getCallerGymId(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<{ gymId: string | null; error: AppError | null }> {
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();

  if (claimsError) {
    return { gymId: null, error: await mapAndLog(claimsError) };
  }

  const gymId = (claimsData?.claims as { gym_id?: string } | undefined)?.gym_id;
  if (!gymId) {
    return { gymId: null, error: await classNotFoundError("no gym_id claim on caller's session") };
  }

  return { gymId, error: null };
}

export interface ClassRow {
  id: string;
  name: string;
  description: string | null;
  coachId: string;
  coachName: string;
  capacity: number;
  scheduleType: "one_off" | "recurring";
  oneOffSessionAt: string | null;
  recurrenceDays: number[] | null;
  recurrenceTime: string | null;
  recurrenceStartDate: string | null;
  /** Soonest future `class_sessions` row for this class, or `null` if none
   * has been materialized yet (should not normally happen post-creation,
   * but a class whose recurring pattern has no matching day-of-week within
   * the rolling window is theoretically possible). */
  nextSessionAt: string | null;
  /** Live `class_bookings` count for `nextSessionAt`'s session, or `0` if
   * there is no next session (nothing to book) or it has zero bookings. */
  bookedCount: number;
}

interface ClassRowFromDb {
  id: string;
  name: string;
  description: string | null;
  coach_id: string;
  capacity: number;
  schedule_type: ClassRow["scheduleType"];
  one_off_session_at: string | null;
  recurrence_days: number[] | null;
  recurrence_time: string | null;
  recurrence_start_date: string | null;
  // Dual-shape acceptance matches coaches.ts's CoachAssignmentRowFromDb --
  // PostgREST's embed cardinality inference isn't reflected in the query
  // builder's inferred TS type here.
  members: { name: string } | { name: string }[] | null;
}

function toClassRow(row: ClassRowFromDb, nextSessionAt: string | null, bookedCount: number): ClassRow {
  const coach = Array.isArray(row.members) ? row.members[0] : row.members;
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    coachId: row.coach_id,
    coachName: coach?.name ?? "",
    capacity: row.capacity,
    scheduleType: row.schedule_type,
    oneOffSessionAt: row.one_off_session_at,
    recurrenceDays: row.recurrence_days,
    recurrenceTime: row.recurrence_time,
    recurrenceStartDate: row.recurrence_start_date,
    nextSessionAt,
    bookedCount,
  };
}

/** Ordered by created_at ascending, matching listPlans' own stable-ordering
 * discipline. The next-session-per-class lookup is a second, separate query
 * (Supabase/PostgREST has no `DISTINCT ON`-style "first matching row per
 * group" join) -- fetches every future session for this gym's classes in one
 * round trip, ordered so the first row seen per class_id is the soonest. */
export async function listClasses(): Promise<{ data: ClassRow[] | null; error: AppError | null }> {
  const supabase = await createClient();
  const { gymId, error: gymIdError } = await getCallerGymId(supabase);
  if (gymIdError || !gymId) {
    return { data: null, error: gymIdError };
  }

  const { data, error } = await supabase
    .from("classes")
    .select(
      "id, name, description, coach_id, capacity, schedule_type, one_off_session_at, recurrence_days, recurrence_time, recurrence_start_date, members(name)",
    )
    .eq("gym_id", gymId)
    .order("created_at", { ascending: true });

  if (error) {
    return { data: null, error: await mapAndLog(error) };
  }

  const rows = (data ?? []) as unknown as ClassRowFromDb[];
  if (rows.length === 0) {
    return { data: [], error: null };
  }

  const { data: sessionRows, error: sessionsError } = await supabase
    .from("class_sessions")
    .select("id, class_id, scheduled_at")
    .eq("gym_id", gymId)
    .gte("scheduled_at", new Date().toISOString())
    .order("scheduled_at", { ascending: true });

  if (sessionsError) {
    return { data: null, error: await mapAndLog(sessionsError) };
  }

  const nextSessionByClassId = new Map<string, { id: string; scheduledAt: string }>();
  for (const session of sessionRows ?? []) {
    if (!nextSessionByClassId.has(session.class_id)) {
      nextSessionByClassId.set(session.class_id, { id: session.id, scheduledAt: session.scheduled_at });
    }
  }

  // Story 12.2: real booking counts for each row's next session, replacing
  // the previous hardcoded 0 -- see Story 12.1's Dev Notes "Booking-Count
  // Scope Gap" and this story's own Task 2. A single class_bookings fetch
  // scoped to just the next-session ids (not every future session), counted
  // client-side (PostgREST has no group-by aggregate over a plain select),
  // matching the same fetch-then-count-in-JS shape nextSessionByClassId
  // itself already uses above.
  const nextSessionIds = [...nextSessionByClassId.values()].map((s) => s.id);
  const bookedCountBySessionId = new Map<string, number>();
  if (nextSessionIds.length > 0) {
    const { data: bookingRows, error: bookingsError } = await supabase
      .from("class_bookings")
      .select("class_session_id")
      .in("class_session_id", nextSessionIds);

    if (bookingsError) {
      return { data: null, error: await mapAndLog(bookingsError) };
    }

    for (const booking of bookingRows ?? []) {
      bookedCountBySessionId.set(
        booking.class_session_id,
        (bookedCountBySessionId.get(booking.class_session_id) ?? 0) + 1,
      );
    }
  }

  return {
    data: rows.map((row) => {
      const nextSession = nextSessionByClassId.get(row.id);
      return toClassRow(
        row,
        nextSession?.scheduledAt ?? null,
        nextSession ? (bookedCountBySessionId.get(nextSession.id) ?? 0) : 0,
      );
    }),
    error: null,
  };
}

export interface ClassWriteInput {
  name: string;
  description: string | null;
  coachId: string;
  capacity: number;
  scheduleType: ClassRow["scheduleType"];
  oneOffSessionAt: string | null;
  recurrenceDays: number[] | null;
  recurrenceTime: string | null;
  recurrenceStartDate: string | null;
}

/** Calls `create_class` (0057) -- a single SECURITY DEFINER transaction that
 * inserts the class row and materializes its first session(s) atomically,
 * so an "insert" that reports success always means a class with a real
 * session exists, and a failure at either step rolls back both (no
 * session-less orphan, no separate compensating-delete round trip to get
 * wrong). Review fix: replaces the previous insert-then-separately-call-
 * materialize_class_sessions pattern, whose compensating delete on
 * materialize failure was never itself checked for success. */
export async function insertClass(
  input: ClassWriteInput,
): Promise<{ data: { id: string } | null; error: AppError | null }> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("create_class", {
    p_name: input.name,
    p_description: input.description,
    p_coach_id: input.coachId,
    p_capacity: input.capacity,
    p_schedule_type: input.scheduleType,
    p_one_off_session_at: input.oneOffSessionAt,
    p_recurrence_days: input.recurrenceDays,
    p_recurrence_time: input.recurrenceTime,
    p_recurrence_start_date: input.recurrenceStartDate,
  });

  if (error || !data) {
    return { data: null, error: await mapAndLog(error) };
  }

  return { data: { id: data }, error: null };
}

/** Calls `update_class` (0057) -- a single SECURITY DEFINER transaction that
 * updates the class row and, only if the schedule actually changed
 * (computed inside the same transaction via typed `IS DISTINCT FROM`
 * comparisons against the pre-update row, not a JS-side string comparison
 * across the client/DB boundary), deletes future sessions and re-
 * materializes. Review fix: replaces the previous update-then-separately-
 * call-materialize_class_sessions pattern, which (a) had no compensating
 * action if materialization failed after the row UPDATE had already
 * committed, and (b) relied on the caller (editClass) comparing serialized
 * timestamp/time strings that mismatched in format on nearly every edit. */
export async function updateClass(
  classId: string,
  input: ClassWriteInput,
): Promise<{ error: AppError | null }> {
  const supabase = await createClient();

  const { error } = await supabase.rpc("update_class", {
    p_class_id: classId,
    p_name: input.name,
    p_description: input.description,
    p_coach_id: input.coachId,
    p_capacity: input.capacity,
    p_schedule_type: input.scheduleType,
    p_one_off_session_at: input.oneOffSessionAt,
    p_recurrence_days: input.recurrenceDays,
    p_recurrence_time: input.recurrenceTime,
    p_recurrence_start_date: input.recurrenceStartDate,
  });

  if (error) {
    return { error: await mapAndLog(error) };
  }

  return { error: null };
}

/** Thin wrapper over `log_audit_event`, following logPlanChange's pattern:
 * same `{error}`-only return shape, same "audit write failed" console.error
 * + mapAndLog. Classes are gym-scoped -- p_gym_id is always the caller's own
 * gym, resolved internally rather than trusted from a caller-supplied
 * value. */
export async function logClassChange(
  actionType: "class_created" | "class_edited",
  classId: string,
  metadata: Record<string, unknown>,
): Promise<{ error: AppError | null }> {
  const supabase = await createClient();
  const { gymId, error: gymIdError } = await getCallerGymId(supabase);
  if (gymIdError || !gymId) {
    return { error: gymIdError };
  }

  const { error } = await supabase.rpc("log_audit_event", {
    p_action_type: actionType,
    p_gym_id: gymId,
    p_target_entity_id: classId,
    p_target_entity_type: "class",
    p_metadata: metadata,
  });

  if (error) {
    console.error(`[logClassChange] audit log write failed for class ${classId}`, error);
    return { error: await mapAndLog(error) };
  }
  return { error: null };
}
