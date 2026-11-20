import { createClient } from "@/lib/supabase/server";
import { type AppError, type ClassSlot } from "@gymos/types";
import { mapAndLog } from "@/services/session";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getServerTranslation } from "@/lib/i18n/get-server-translation";

/** How far into the past a session can be and still count as "next" for
 * `listClasses()`'s row-expand target -- see that function's own comment.
 * 3 hours comfortably covers any realistic class length plus staff getting
 * to marking attendance a bit late, without keeping a session markable for
 * days. */
const NEXT_SESSION_GRACE_HOURS = 3;

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

/** Story 17.2 (AC #3, #8): the Overview's "Today's classes" card -- every
 * session scheduled in the half-open range, finished ones included. The
 * bounds are the UTC instants of the gym-local day from
 * `getGymLocalPeriodBounds()`. A head COUNT, not `listClasses()`, which
 * fetches rows and counts in JS. A cancelled session (Story 29.2,
 * `class_sessions.cancelled_at`) is not a class that runs today, so it is
 * not counted. */
export async function countClassSessionsBetween(
  startIso: string,
  endIsoExclusive: string,
): Promise<{ data: number | null; error: AppError | null }> {
  const supabase = await createClient();
  const { gymId, error: gymIdError } = await getCallerGymId(supabase);
  if (gymIdError || !gymId) {
    return { data: null, error: gymIdError };
  }

  const { count, error } = await supabase
    .from("class_sessions")
    .select("id", { count: "exact", head: true })
    .eq("gym_id", gymId)
    .is("cancelled_at", null)
    .gte("scheduled_at", startIso)
    .lt("scheduled_at", endIsoExclusive);

  if (error) {
    return { data: null, error: await mapAndLog(error) };
  }

  return { data: count ?? 0, error: null };
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
  /** Story 29.2: the class's weekly times (empty for a one-off class). Stored as rows since 0180; a migrated class reads one slot per old day. */
  slots: ClassSlot[];
  recurrenceStartDate: string | null;
  /** Story 29.2: set when the class was cancelled; a cancelled class stays listed, sorts below live ones and offers no action. */
  cancelledAt: string | null;
  /** Story 29.2: bookings on this class's upcoming sessions, what the Cancel class dialog shows (the server counts the same rows when it cancels). */
  upcomingBookingCount: number;
  /** Story 29.2: false when `nextSessionId`'s session no longer matches the class's weekly times (the "Old time" tag); null when there is no next session or it has already started. */
  nextSessionMatchesSlots: boolean | null;
  /** Soonest future `class_sessions` row for this class, or `null` if none
   * has been materialized yet (should not normally happen post-creation,
   * but a class whose recurring pattern has no matching day-of-week within
   * the rolling window is theoretically possible). */
  nextSessionAt: string | null;
  /** id of the `class_sessions` row `nextSessionAt` refers to, or `null` if
   * there is no next session -- Story 12.3's row-expand attendance panel
   * fetches this session's bookings. */
  nextSessionId: string | null;
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
  recurrence_start_date: string | null;
  cancelled_at: string | null;
  class_schedule_slots: { weekday: number; start_time: string }[] | null;
  // Dual-shape acceptance matches coaches.ts's CoachAssignmentRowFromDb --
  // PostgREST's embed cardinality inference isn't reflected in the query
  // builder's inferred TS type here.
  members: { name: string } | { name: string }[] | null;
}

function toClassRow(
  row: ClassRowFromDb,
  nextSessionAt: string | null,
  nextSessionId: string | null,
  bookedCount: number,
  upcomingBookingCount: number,
  nextSessionMatchesSlots: boolean | null,
): ClassRow {
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
    slots: (row.class_schedule_slots ?? []).map((s) => ({ weekday: s.weekday, startTime: s.start_time.slice(0, 5) })),
    recurrenceStartDate: row.recurrence_start_date,
    cancelledAt: row.cancelled_at,
    upcomingBookingCount,
    nextSessionMatchesSlots,
    nextSessionAt,
    nextSessionId,
    bookedCount,
  };
}

/** Ordered by created_at ascending, matching listPlans' own stable-ordering
 * discipline. The next-session-per-class lookup is a second, separate query
 * (Supabase/PostgREST has no `DISTINCT ON`-style "first matching row per
 * group" join) -- fetches every session from `NEXT_SESSION_GRACE_HOURS` in
 * the past onward for this gym's classes in one round trip, ordered so the
 * first row seen per class_id is the soonest. Review fix (Story 12.3): the
 * grace window keeps a session that just started/ended reachable as
 * "next" -- without it, a session strictly filtered to `scheduled_at >= now()`
 * would drop out of consideration the instant it began, making
 * Story 12.3's row-expand attendance panel jump straight to the class's
 * *following* occurrence right when staff most need to mark attendance for
 * the one happening now. */
export async function listClasses(): Promise<{ data: ClassRow[] | null; error: AppError | null }> {
  const supabase = await createClient();
  const { gymId, error: gymIdError } = await getCallerGymId(supabase);
  if (gymIdError || !gymId) {
    return { data: null, error: gymIdError };
  }

  const { data, error } = await supabase
    .from("classes")
    .select(
      "id, name, description, coach_id, capacity, schedule_type, one_off_session_at, recurrence_start_date, cancelled_at, members!classes_coach_id_fkey(name), class_schedule_slots(weekday, start_time)",
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

  const graceWindowStart = new Date(Date.now() - NEXT_SESSION_GRACE_HOURS * 60 * 60 * 1000).toISOString();
  const { data: sessionRows, error: sessionsError } = await supabase
    .from("class_sessions")
    .select("id, class_id, scheduled_at, class_bookings(count)")
    .eq("gym_id", gymId)
    .is("cancelled_at", null)
    .gte("scheduled_at", graceWindowStart)
    .order("scheduled_at", { ascending: true });

  if (sessionsError) {
    return { data: null, error: await mapAndLog(sessionsError) };
  }

  const nextSessionByClassId = new Map<string, { id: string; scheduledAt: string }>();
  // Story 29.2: bookings on each class's UPCOMING sessions (scheduled_at > now, exactly what cancel_class counts), from the same fetch.
  const upcomingBookingsByClassId = new Map<string, number>();
  const nowMs = Date.now();
  for (const session of (sessionRows ?? []) as unknown as {
    id: string;
    class_id: string;
    scheduled_at: string;
    class_bookings: { count: number }[] | null;
  }[]) {
    if (!nextSessionByClassId.has(session.class_id)) {
      nextSessionByClassId.set(session.class_id, { id: session.id, scheduledAt: session.scheduled_at });
    }
    if (new Date(session.scheduled_at).getTime() > nowMs) {
      upcomingBookingsByClassId.set(
        session.class_id,
        (upcomingBookingsByClassId.get(session.class_id) ?? 0) + Number(session.class_bookings?.[0]?.count ?? 0),
      );
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

  // Story 29.2: whether each next session still matches its class's weekly times, from the class_sessions_with_match view (the single
  // source of the "Old time" tag; a one-off class's session always matches).
  const matchesBySessionId = new Map<string, boolean>();
  if (nextSessionIds.length > 0) {
    const { data: matchRows, error: matchError } = await supabase
      .from("class_sessions_with_match")
      .select("class_session_id, matches_slots")
      .in("class_session_id", nextSessionIds);

    if (matchError) {
      return { data: null, error: await mapAndLog(matchError) };
    }

    for (const match of matchRows ?? []) {
      if (match.class_session_id !== null && match.matches_slots !== null) {
        matchesBySessionId.set(match.class_session_id, match.matches_slots);
      }
    }
  }

  return {
    data: rows.map((row) => {
      const nextSession = nextSessionByClassId.get(row.id);
      return toClassRow(
        row,
        nextSession?.scheduledAt ?? null,
        nextSession?.id ?? null,
        nextSession ? (bookedCountBySessionId.get(nextSession.id) ?? 0) : 0,
        upcomingBookingsByClassId.get(row.id) ?? 0,
        nextSession && new Date(nextSession.scheduledAt).getTime() > nowMs ? (matchesBySessionId.get(nextSession.id) ?? null) : null,
      );
    }),
    error: null,
  };
}

/** Story 29.2: the gym's IANA time zone, for the weekly-times editor's "Times are in the gym's time zone" line and the result view. */
export async function getClassesGymTimezone(): Promise<{ data: string | null; error: AppError | null }> {
  const supabase = await createClient();
  const { gymId, error: gymIdError } = await getCallerGymId(supabase);
  if (gymIdError || !gymId) {
    return { data: null, error: gymIdError };
  }

  const { data, error } = await supabase.from("gyms").select("timezone").eq("id", gymId).maybeSingle();
  if (error) {
    return { data: null, error: await mapAndLog(error) };
  }
  return { data: data?.timezone ?? null, error: null };
}

export interface SessionBookingRow {
  id: string;
  memberId: string;
  memberName: string;
  attended: boolean;
}

interface SessionBookingRowFromDb {
  id: string;
  member_id: string;
  attended_at: string | null;
  // Dual-shape acceptance matches toClassRow's own members embed handling --
  // PostgREST's embed cardinality inference isn't reflected in the query
  // builder's inferred TS type here.
  members: { name: string } | { name: string }[] | null;
}

/** Story 12.3: booked members for one class session's row-expand panel
 * (AC #1). RLS already scopes reads to the caller's own gym + role via
 * gym_staff_read_own_class_bookings, but `.eq("gym_id", gymId)` is still
 * added explicitly, matching every other query in this file's
 * defense-in-depth discipline. */
export async function listSessionBookings(
  classSessionId: string,
): Promise<{ data: SessionBookingRow[] | null; error: AppError | null }> {
  const supabase = await createClient();
  const { gymId, error: gymIdError } = await getCallerGymId(supabase);
  if (gymIdError || !gymId) {
    return { data: null, error: gymIdError };
  }

  const { data, error } = await supabase
    .from("class_bookings")
    .select("id, member_id, attended_at, members(name)")
    .eq("gym_id", gymId)
    .eq("class_session_id", classSessionId)
    .order("created_at", { ascending: true });

  if (error) {
    return { data: null, error: await mapAndLog(error) };
  }

  const rows = (data ?? []) as unknown as SessionBookingRowFromDb[];
  return {
    data: rows.map((row) => {
      const member = Array.isArray(row.members) ? row.members[0] : row.members;
      return {
        id: row.id,
        memberId: row.member_id,
        memberName: member?.name ?? "",
        attended: row.attended_at !== null,
      };
    }),
    error: null,
  };
}

/** Story 17.4 (AC #7): one session of one of the calling Coach's own
 * classes, from 00:00 today in the gym's timezone onward. */
export interface CoachClassSessionRow {
  classSessionId: string;
  scheduledAt: string;
  bookedCount: number;
  /** Story 29.2: false when the session was kept on an old time after a weekly-times edit (the "Old time" tag); absent reads as matching. */
  matchesSlots?: boolean;
}

/** Story 17.4 (AC #7): a class the calling Coach teaches, with its sessions
 * in the window. `sessions` is empty for a class with none (a finished
 * one-off class, or a recurring class that has not started yet). */
export interface CoachClassRow {
  classId: string;
  className: string;
  /** Story 29.3: the Edit modal's description and start date (`list_my_classes()`, 0182). Optional so a reader of the Overview caseload need not carry them. */
  description?: string | null;
  recurrenceStartDate?: string | null;
  capacity: number;
  scheduleType: "one_off" | "recurring";
  oneOffSessionAt: string | null;
  /** Story 29.2: the weekly times (empty for a one-off class). */
  slots: ClassSlot[];
  /** Story 29.2: set for a cancelled class, which shows the neutral Cancelled badge. */
  cancelledAt: string | null;
  gymTimezone: string;
  sessions: CoachClassSessionRow[];
}

/** Story 17.4 (AC #7): one booking on a session's roster -- exactly the three
 * columns `list_my_class_session_roster()` returns, never more. */
export interface CoachRosterRow {
  memberId: string;
  memberName: string;
  attendedAt: string | null;
}

/** Story 29.2: `slots` from `list_my_classes()` is a jsonb array of `{weekday, start_time "HH:MM"}`; anything else reads as no slots. */
function parseSlots(raw: unknown): ClassSlot[] {
  if (!Array.isArray(raw)) return [];
  const slots: ClassSlot[] = [];
  for (const item of raw) {
    const entry = item as { weekday?: unknown; start_time?: unknown } | null;
    if (entry && typeof entry.weekday === "number" && typeof entry.start_time === "string") {
      slots.push({ weekday: entry.weekday, startTime: entry.start_time.slice(0, 5) });
    }
  }
  return slots;
}

/** Story 17.4 (AC #7): the Coach Portal's My Classes list, from
 * `list_my_classes()` (0096). Deliberately NOT `listClasses()`: under a Coach
 * session its `class_bookings` read returns zero rows without an error
 * (gym_staff_read_own_class_bookings excludes coach, 0068), so every count
 * would read 0. The RPC resolves the Coach and the gym server-side from the
 * session, so there is no getCallerGymId() step and no argument. It returns
 * one row per (class, session); rows are grouped per class in the SQL's own
 * order, and a class with no session in the window arrives as a single row
 * whose session columns are null. Zero rows -- including every non-coach
 * caller, by design -- is an empty list, not an error. */
export async function listMyClasses(): Promise<{ data: CoachClassRow[] | null; error: AppError | null }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_my_classes");

  if (error) {
    return { data: null, error: await mapAndLog(error) };
  }

  const byClassId = new Map<string, CoachClassRow>();
  for (const row of data ?? []) {
    let cls = byClassId.get(row.class_id);
    if (!cls) {
      cls = {
        classId: row.class_id,
        className: row.class_name,
        description: row.description,
        recurrenceStartDate: row.recurrence_start_date,
        capacity: row.capacity,
        scheduleType: row.schedule_type as CoachClassRow["scheduleType"],
        oneOffSessionAt: row.one_off_session_at,
        slots: parseSlots(row.slots),
        cancelledAt: row.cancelled_at,
        gymTimezone: row.gym_timezone,
        sessions: [],
      };
      byClassId.set(row.class_id, cls);
    }
    if (row.class_session_id !== null && row.scheduled_at !== null) {
      cls.sessions.push({
        classSessionId: row.class_session_id,
        scheduledAt: row.scheduled_at,
        // bigint over PostgREST: normally a JSON number, but never trust it.
        bookedCount: Number(row.booked_count),
        // A session that has already started never carries the "Old time" tag (the page lists sessions from 00:00 today); listClasses does the same.
        matchesSlots: row.matches_slots !== false || new Date(row.scheduled_at).getTime() <= Date.now(),
      });
    }
  }

  return { data: [...byClassId.values()], error: null };
}

/** Story 17.4 (AC #7): who is booked into one session, from
 * `list_my_class_session_roster()` (0096). The RPC is the authorization
 * boundary: it returns rows only for a session of the calling Coach's own
 * class, and an empty set for anything else, so an empty roster here can mean
 * "no one booked" or "not yours" -- the page only ever asks for sessions
 * `listMyClasses()` returned. A non-uuid id is rejected by Postgres and comes
 * back as a mapped error. */
export async function listMyClassSessionRoster(
  classSessionId: string,
): Promise<{ data: CoachRosterRow[] | null; error: AppError | null }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_my_class_session_roster", {
    p_class_session_id: classSessionId,
  });

  if (error) {
    return { data: null, error: await mapAndLog(error) };
  }

  return {
    data: (data ?? []).map((row: { member_id: string; member_name: string; attended_at: string | null }) => ({
      memberId: row.member_id,
      memberName: row.member_name,
      attendedAt: row.attended_at,
    })),
    error: null,
  };
}

/** Story 12.3: marks one booking attended via `mark_class_attendance()`
 * (AC #2, #3). The RPC's own explicit `null` return (not an `error`) is its
 * documented rejection contract -- an expired/no-subscription member's
 * booking, which also fires a real-time front-desk alert server-side. That
 * case is surfaced here as `rejected: true` so the caller can tell it apart
 * from a thrown `error`, following this file's existing `{ data, error }`
 * shape extended minimally rather than inventing a new pattern.
 *
 * Bug found via manual browser QA, not caught by pgTAP: PostgREST does not
 * serialize a SQL `NULL` returned from a composite-returning RPC as JSON
 * `null` -- it serializes as an object with every field `null` (e.g.
 * `{"id":null,"gym_id":null,...}`), since a `NULL::class_bookings` is still
 * structurally a row, just one with every column unset. pgTAP never
 * exercises this: it calls the SQL function directly, where the return
 * value is genuinely SQL `NULL`, not the JSON that flows over the
 * PostgREST/HTTP layer this RPC call actually goes through. `data.id` (the
 * primary key, never legitimately null on a real success) is the correct
 * rejection signal here, not `data === null`. */
export async function markAttendance(
  bookingId: string,
): Promise<{ data: SessionBookingRow | null; rejected: boolean; error: AppError | null }> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("mark_class_attendance", { p_booking_id: bookingId });

  if (error) {
    return { data: null, rejected: false, error: await mapAndLog(error) };
  }

  if (data === null || data.id === null) {
    return { data: null, rejected: true, error: null };
  }

  // Story 19.7 (0112): at a gym that charges per session a refusal is a
  // returned row with attended_at null (a raise would roll back the attempt
  // and the alert). Every success sets attended_at, so null is the signal.
  if (data.attended_at === null || data.attended_at === undefined) {
    return {
      data: null,
      rejected: false,
      error: {
        code: "session_required",
        message: "No paid session — attendance was not recorded. A front-desk alert has been raised.",
      },
    };
  }

  // mark_class_attendance() returns a bare class_bookings row (no member
  // join) -- memberName is left blank here since the caller already holds
  // it locally (it rendered the row that triggered this call in the first
  // place) and re-fetching just for a name would be wasted work.
  return {
    data: { id: data.id, memberId: data.member_id, memberName: "", attended: data.attended_at !== null },
    rejected: false,
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
  /** Story 29.2: the weekly times of a recurring class (1 to 14), null for a one-off class. */
  slots: ClassSlot[] | null;
  recurrenceStartDate: string | null;
}

/** The `p_slots` payload of the 0181 overloads: `[{weekday, start_time "HH:MM"}]`, or null for a one-off class. */
function toSlotsPayload(slots: ClassSlot[] | null) {
  return slots === null ? null : slots.map((s) => ({ weekday: s.weekday, start_time: s.startTime }));
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
    p_recurrence_days: null,
    p_recurrence_time: null,
    p_recurrence_start_date: input.recurrenceStartDate,
    p_slots: toSlotsPayload(input.slots),
  });

  if (error || !data) {
    return { data: null, error: (error ? await mapCoachOwnOnly(error) : null) ?? (await mapAndLog(error)) };
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
): Promise<{ data: { leftUnchanged: LeftUnchangedSession[] } | null; error: AppError | null }> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("update_class", {
    p_class_id: classId,
    p_name: input.name,
    p_description: input.description,
    p_coach_id: input.coachId,
    p_capacity: input.capacity,
    p_schedule_type: input.scheduleType,
    p_one_off_session_at: input.oneOffSessionAt,
    p_recurrence_days: null,
    p_recurrence_time: null,
    p_recurrence_start_date: input.recurrenceStartDate,
    p_slots: toSlotsPayload(input.slots),
  });

  if (error) {
    return { data: null, error: (await mapCoachOwnOnly(error)) ?? (await mapAlreadyCancelled(error)) ?? (await mapAndLog(error)) };
  }

  return { data: { leftUnchanged: parseLeftUnchanged(data) }, error: null };
}

/** Story 29.2: `cancel_class` and `update_class` both raise "... is already cancelled" for a cancelled class (a stale tab); that is its own
 * code, `class_already_cancelled`, message `classes.cancel.already`. Null for any other error. */
async function mapAlreadyCancelled(error: { message?: string | null }): Promise<AppError | null> {
  if (!/already cancelled/i.test(error.message ?? "")) return null;
  const { t } = await getServerTranslation(await getRequestLocale());
  return { code: "class_already_cancelled", message: t("classes.cancel.already") };
}

/** Story 29.3: `create_class`, `update_class` and `cancel_class` raise "... coaches can only manage their own classes" when a Coach touches a class
 * (or names a coach) that is not theirs: another coach's class, another gym's class and a missing class all read the same. That is its own code,
 * `class_coach_own_only`, message `classes.coach.ownOnly`. Null for any other error. */
async function mapCoachOwnOnly(error: { message?: string | null }): Promise<AppError | null> {
  if (!/coaches can only manage their own classes/i.test(error.message ?? "")) return null;
  const { t } = await getServerTranslation(await getRequestLocale());
  return { code: "class_coach_own_only", message: t("classes.coach.ownOnly") };
}

/** Story 29.2: a future session an edit left alone because it has bookings (`update_class`'s `left_unchanged`). */
export interface LeftUnchangedSession {
  classSessionId: string;
  scheduledAt: string;
  bookedCount: number;
  capacity: number;
}

function parseLeftUnchanged(raw: unknown): LeftUnchangedSession[] {
  const list = (raw as { left_unchanged?: unknown } | null)?.left_unchanged;
  if (!Array.isArray(list)) return [];
  const out: LeftUnchangedSession[] = [];
  for (const item of list) {
    const e = item as { class_session_id?: unknown; scheduled_at?: unknown; booked_count?: unknown; capacity?: unknown } | null;
    if (e && typeof e.class_session_id === "string" && typeof e.scheduled_at === "string") {
      out.push({
        classSessionId: e.class_session_id,
        scheduledAt: e.scheduled_at,
        bookedCount: Number(e.booked_count),
        capacity: Number(e.capacity),
      });
    }
  }
  return out;
}

/** Story 29.2: cancels a class through `cancel_class()` (0181). Flags the class and its future sessions on the server, deletes nothing, and
 * returns the server-counted number of bookings on those sessions. An already-cancelled class gets its own code
 * (`class_already_cancelled`, message `classes.cancel.already`); every other failure is `class_cancel_failed`
 * (`classes.cancel.error`), the real cause logged server-side only. A one-off class whose session is already past gets `class_nothing_to_cancel`
 * (`classes.cancel.nothingLeft`). */
export async function cancelClass(
  classId: string,
): Promise<{ data: { bookingsCancelled: number } | null; error: AppError | null }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("cancel_class", { p_class_id: classId });

  if (error) {
    const ownOnly = await mapCoachOwnOnly(error);
    if (ownOnly) return { data: null, error: ownOnly };
    const already = await mapAlreadyCancelled(error);
    if (already) return { data: null, error: already };
    const { t } = await getServerTranslation(await getRequestLocale());
    if (/nothing left to cancel/i.test(error.message ?? "")) {
      return { data: null, error: { code: "class_nothing_to_cancel", message: t("classes.cancel.nothingLeft") } };
    }
    console.error("[cancelClass] failed", error);
    return { data: null, error: { code: "class_cancel_failed", message: t("classes.cancel.error") } };
  }

  const count = Number((data as { bookings_cancelled?: unknown } | null)?.bookings_cancelled ?? 0);
  return { data: { bookingsCancelled: Number.isFinite(count) ? count : 0 }, error: null };
}

/** Thin wrapper over `log_audit_event`, following logPlanChange's pattern:
 * same `{error}`-only return shape, same "audit write failed" console.error
 * + mapAndLog. Classes are gym-scoped -- p_gym_id is always the caller's own
 * gym, resolved internally rather than trusted from a caller-supplied
 * value. */
export async function logClassChange(
  actionType: "class_created" | "class_created_by_coach" | "class_edited",
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
