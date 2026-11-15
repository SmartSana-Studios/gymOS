import { createClient } from "@/lib/supabase/server";
import { type AppError, parsePageSize } from "@gymos/types";
import { mapAndLog } from "@/services/session";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getServerTranslation } from "@/lib/i18n/get-server-translation";
import type { MemberSubscriptionStatus } from "@/services/members";
import { getGymLocalPeriodBounds } from "@/services/gym-settings";

// Default rows per page (the user can pick 5/10/25/50).
export const ATTENDANCE_LOG_PAGE_SIZE = 5;

/** No dedicated "gym not found" copy exists for this file (unlike
 * gym-settings.ts's own gymNotFoundError) -- reuses the existing
 * `members.errors.memberNotFound` key as the generic not-found fallback,
 * matching csvImport.ts's own precedent for a service file that isn't
 * primarily about members but still needs one. `context` is logged
 * server-side only, never shown to the caller. */
async function attendanceNotFoundError(context: string): Promise<AppError> {
  console.warn(`[attendance] resolved to not_found: ${context}`);
  const { t } = await getServerTranslation(await getRequestLocale());
  return { code: "not_found", message: t("members.errors.memberNotFound") };
}

/** Every function in this file needs the caller's own `gym_id`, read from
 * claims -- copied verbatim from members.ts/plans.ts's own (unexported)
 * helper rather than reaching across service files, matching this app's
 * established per-file-copy discipline. */
async function getCallerGymId(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<{ gymId: string | null; role: string | null; error: AppError | null }> {
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();

  if (claimsError) {
    return { gymId: null, role: null, error: await mapAndLog(claimsError) };
  }

  const claims = claimsData?.claims as { gym_id?: string; app_role?: string } | undefined;
  const gymId = claims?.gym_id;
  if (!gymId) {
    return { gymId: null, role: null, error: await attendanceNotFoundError("no gym_id claim on caller's session") };
  }

  // The role only picks WHICH read serves the page (a GymOS Support session has no attendance_events policy, so it reads through
  // list_attendance_log); the database decides what any caller may see either way.
  return { gymId, role: claims?.app_role ?? null, error: null };
}

/** Today's UTC calendar-day boundaries, [start, end) -- Scope Note #4's
 * documented, accepted gap: gyms.timezone exists but no query in this
 * codebase uses it for date-boundary math yet (deferred-work.md,
 * 0022_manual_renewal_reset.sql:60-64's own precedent). Returns ISO date
 * strings (`YYYY-MM-DD`) for `from`/`to` defaults and ISO timestamps for the
 * `.gte()`/`.lt()` query bounds. Exported so `page.tsx` shares this single
 * definition instead of keeping its own duplicate (Review Finding). */
export function todayUtcDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function dateStartIso(dateStr: string): string {
  return `${dateStr}T00:00:00.000Z`;
}

function dateEndExclusiveIso(dateStr: string): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return next.toISOString();
}

/** True only for a real, well-formed calendar date (rejects `"2026-02-30"`,
 * not just malformed strings) -- `Date.UTC` silently rolls invalid
 * day/month values over into the next period instead of erroring. */
function isValidDateString(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** Resolves a caller-supplied `from`/`to` query param to a safe date string,
 * falling back to `fallback` when absent OR malformed (Review Finding: an
 * unvalidated date string reaching `dateEndExclusiveIso` below produces
 * `new Date(NaN).toISOString()`, a thrown `RangeError` that crashes the
 * page render -- a hand-edited URL or a cleared `<input type="date">`, which
 * emits `""` rather than `undefined`, both reach here). */
export function resolveDateParam(value: string | undefined, fallback: string): string {
  return value && isValidDateString(value) ? value : fallback;
}

// Escapes ilike's wildcard characters and the quote character used to wrap
// the value below -- copied verbatim from members.ts's escapeIlike (same
// escaping rationale, no cross-service import per this app's discipline).
function escapeIlike(value: string): string {
  return value.replace(/[\\%_"]/g, (char) => `\\${char}`);
}

/** Story 3.5: Check-Out -- Manual & Auto-Timeout. Calls the staff-driven
 * `check_out_member()` SECURITY DEFINER RPC (0024_check_out_manual_auto_timeout.sql),
 * which self-enforces the owner/manager/receptionist role check and the
 * gym-scoped lookup internally. Returns the checkout timestamp (Scope Note
 * #5) now that Story 3.6 builds the consuming Check Out button UI and needs
 * it to display -- Story 3.5 itself discarded the RPC's own return value
 * since no caller needed it yet. */
export async function checkOutMember(
  memberId: string,
): Promise<{ data: { checkedOutAt: string } | null; error: AppError | null }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("check_out_member", { p_member_id: memberId });
  if (error || !data) {
    return { data: null, error: await mapAndLog(error) };
  }
  return { data: { checkedOutAt: data.checked_out_at }, error: null };
}

export type AttendanceSource = "qr" | "staff";

/** What the Entry column and the [Void] action need from one attendance row (Story 27.3, UX AD-11 V1.8). */
export interface AttendanceEntryInfo {
  source: AttendanceSource;
  /** The staff member who entered a staff row ("GymOS Support" for support); null for a scan, or when the name did not resolve:
   * the cell then reads "By staff" with no name and the row stays usable. */
  enteredByLabel: string | null;
  /** A staff entry of the current gym-local day that is not voided, as the DATABASE says (list_attendance_log.voidable). The role gate
   * is the caller's; void_staff_check_in re-checks everything. */
  voidable: boolean;
  /** For a voidable row: the entry consumed a paid or free session (the Void modal says it is given back). Null otherwise. */
  consumedSession: boolean | null;
  /** For a voidable row: the entry earned a loyalty stamp that is still counted (the Void modal says it is removed). Null otherwise. */
  earnedStamp: boolean | null;
}

export interface CurrentlyCheckedInRow extends AttendanceEntryInfo {
  attendanceId: string;
  memberId: string;
  name: string;
  checkedInAt: string;
  status: MemberSubscriptionStatus | "no_active_plan";
  deactivatedAt: string | null;
}

interface CurrentlyCheckedInRowFromDb {
  id: string;
  member_id: string;
  checked_in_at: string;
  source: string;
  members: { name: string; deactivated_at: string | null } | null;
}

/** One row of public.list_attendance_log (0175). */
interface AttendanceLogRpcRow {
  attendance_id: string;
  member_id: string;
  member_name: string;
  checked_in_at: string;
  checked_out_at: string | null;
  checkout_type: string | null;
  source: string;
  entered_by_label: string | null;
  voided_at: string | null;
  voided_by_label: string | null;
  void_reason: string | null;
  voidable: boolean;
  consumed_session: boolean | null;
  earned_stamp: boolean | null;
}

function toSource(value: string): AttendanceSource {
  return value === "staff" ? "staff" : "qr";
}

/** How far back an open check-in can still be open: the auto-timeout job closes every visit older than the gym's timeout (hours), so
 * a window of a week is a safe superset for "who is open now" read through list_attendance_log. */
const OPEN_VISIT_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

/** Open sessions only (`checked_out_at is null`), joined to `members(name,
 * deactivated_at)`. Sorted by `checked_in_at` ascending (earliest arrival
 * first) -- distinct from the Daily Log's own newest-first convention
 * below, matching AD-11's "Currently Checked-In" table spec. Paginated the
 * same way as the Daily Log (Review Finding, resolved 2026-07-28: an
 * uncapped table doesn't scale for a busy gym) -- `total` always reflects
 * every open session gym-wide, independent of which page is rendered, so
 * the "Currently Checked In (N members)" header stays accurate.
 *
 * Each member's most recent subscription status is resolved via a second,
 * flat query rather than a two-level-deep nested embed
 * (`members.subscriptions`, ordered/limited at that nesting) -- no
 * precedent anywhere in this codebase for refining an embed that's nested
 * two levels below the queried table, unlike `listMembers`'s own
 * one-level-deep `subscriptions` embed/order/limit(1) pattern
 * (apps/dashboard/services/members.ts:210-220). Fetching all matching
 * subscriptions ordered by `created_at` descending (then `id` descending as
 * a deterministic tiebreaker -- Review Finding: two subscriptions created in
 * the same millisecond otherwise "win" nondeterministically) and keeping
 * only the first occurrence per `member_id` in-process reproduces the same
 * "most recent subscription" result without relying on that nesting depth.
 *
 * Story 27.3: staff keep reading `attendance_counted` (a voided visit is never in it); the Entry column and [Void] need the staff
 * member's name and the same-day flag, which only list_attendance_log resolves, so a page that holds a staff entry asks it once for
 * those rows. A GymOS Support session has no attendance_events policy at all, so it reads the open rows from list_attendance_log. */
export async function getCurrentlyCheckedIn(params: { page?: number; pageSize?: number } = {}): Promise<{
  data: { rows: CurrentlyCheckedInRow[]; total: number; page: number } | null;
  error: AppError | null;
}> {
  const supabase = await createClient();
  const { gymId, role, error: gymIdError } = await getCallerGymId(supabase);
  if (gymIdError || !gymId) {
    return { data: null, error: gymIdError };
  }

  const requestedPage = params.page && params.page > 0 ? params.page : 1;
  const pageSize = parsePageSize(params.pageSize, ATTENDANCE_LOG_PAGE_SIZE);

  type OpenRow = {
    attendanceId: string;
    memberId: string;
    name: string;
    deactivatedAt: string | null;
    checkedInAt: string;
    source: AttendanceSource;
    enteredByLabel: string | null;
    voidable: boolean;
    consumedSession: boolean | null;
    earnedStamp: boolean | null;
  };

  let openRows: OpenRow[] = [];
  let total = 0;
  let effectivePage = requestedPage;

  if (role === "support") {
    const windowArgs = {
      p_from: new Date(Date.now() - OPEN_VISIT_LOOKBACK_MS).toISOString(),
      p_to: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    };
    const buildSupportQuery = (page: number) => {
      const from = (page - 1) * pageSize;
      return supabase
        .rpc("list_attendance_log", windowArgs, { count: "exact" })
        .is("checked_out_at", null)
        .is("voided_at", null)
        .order("checked_in_at", { ascending: true })
        .range(from, from + pageSize - 1);
    };
    let result = await buildSupportQuery(requestedPage);
    if (result.error) {
      return { data: null, error: await mapAndLog(result.error) };
    }
    total = result.count ?? 0;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    if (requestedPage > totalPages) {
      effectivePage = totalPages;
      result = await buildSupportQuery(totalPages);
      if (result.error) {
        return { data: null, error: await mapAndLog(result.error) };
      }
    }
    openRows = ((result.data ?? []) as unknown as AttendanceLogRpcRow[]).map((row) => ({
      attendanceId: row.attendance_id,
      memberId: row.member_id,
      name: row.member_name,
      // list_attendance_log does not return deactivation; the status query below does not need it either for an open visit.
      deactivatedAt: null,
      checkedInAt: row.checked_in_at,
      source: toSource(row.source),
      enteredByLabel: row.entered_by_label,
      voidable: row.voidable,
      consumedSession: row.consumed_session,
      earnedStamp: row.earned_stamp,
    }));
  } else {
    const buildQuery = (page: number) => {
      const from = (page - 1) * pageSize;
      const to = from + pageSize - 1;
      return supabase
        .from("attendance_counted")
        .select(`id, member_id, checked_in_at, source, members!inner(name, deactivated_at)`, { count: "exact" })
        .eq("gym_id", gymId)
        .is("checked_out_at", null)
        .order("checked_in_at", { ascending: true })
        .range(from, to);
    };

    const { data, count, error } = await buildQuery(requestedPage);
    if (error) {
      return { data: null, error: await mapAndLog(error) };
    }

    total = count ?? 0;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    let dbRows = (data ?? []) as unknown as CurrentlyCheckedInRowFromDb[];

    // Review Finding: a stale/hand-edited page beyond the last valid page
    // otherwise returns zero rows with no way back -- clamp to the last page
    // instead (mirrors the same fix in listAttendanceLog below).
    if (requestedPage > totalPages) {
      effectivePage = totalPages;
      const { data: clampedData, error: clampedError } = await buildQuery(totalPages);
      if (clampedError) {
        return { data: null, error: await mapAndLog(clampedError) };
      }
      dbRows = (clampedData ?? []) as unknown as CurrentlyCheckedInRowFromDb[];
    }

    // Entry labels and the voidable flag of the staff entries on this page, in one read.
    const detail = new Map<string, { enteredByLabel: string | null; voidable: boolean; consumedSession: boolean | null; earnedStamp: boolean | null }>();
    const staffRows = dbRows.filter((row) => row.source === "staff");
    if (staffRows.length > 0) {
      const earliest = staffRows.reduce((min, row) => (row.checked_in_at < min ? row.checked_in_at : min), staffRows[0].checked_in_at);
      const { data: logData, error: logError } = await supabase.rpc("list_attendance_log", {
        p_from: earliest,
        p_to: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      });
      // A failed enrichment never blocks the page: the cell reads "By staff" with no name and [Void] stays hidden (a safe default).
      if (!logError) {
        for (const row of (logData ?? []) as unknown as AttendanceLogRpcRow[]) {
          detail.set(row.attendance_id, {
            enteredByLabel: row.entered_by_label,
            voidable: row.voidable,
            consumedSession: row.consumed_session,
            earnedStamp: row.earned_stamp,
          });
        }
      }
    }

    openRows = dbRows.map((row) => ({
      attendanceId: row.id,
      memberId: row.member_id,
      name: row.members?.name ?? "",
      deactivatedAt: row.members?.deactivated_at ?? null,
      checkedInAt: row.checked_in_at,
      source: toSource(row.source),
      enteredByLabel: detail.get(row.id)?.enteredByLabel ?? null,
      voidable: detail.get(row.id)?.voidable ?? false,
      consumedSession: detail.get(row.id)?.consumedSession ?? null,
      earnedStamp: detail.get(row.id)?.earnedStamp ?? null,
    }));
  }

  const memberIds = openRows.map((row) => row.memberId);

  const statusByMemberId = new Map<string, MemberSubscriptionStatus>();
  if (memberIds.length > 0) {
    const { data: subscriptionRows, error: subscriptionError } = await supabase
      .from("subscriptions")
      .select("member_id, status, created_at")
      .eq("gym_id", gymId)
      .in("member_id", memberIds)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false });

    if (subscriptionError) {
      return { data: null, error: await mapAndLog(subscriptionError) };
    }

    for (const row of (subscriptionRows ?? []) as { member_id: string; status: MemberSubscriptionStatus }[]) {
      if (!statusByMemberId.has(row.member_id)) {
        statusByMemberId.set(row.member_id, row.status);
      }
    }
  }

  const rows: CurrentlyCheckedInRow[] = openRows.map((row) => ({
    attendanceId: row.attendanceId,
    memberId: row.memberId,
    name: row.name,
    checkedInAt: row.checkedInAt,
    status: statusByMemberId.get(row.memberId) ?? "no_active_plan",
    deactivatedAt: row.deactivatedAt,
    source: row.source,
    enteredByLabel: row.enteredByLabel,
    voidable: row.voidable,
    consumedSession: row.consumedSession,
    earnedStamp: row.earnedStamp,
  }));

  return { data: { rows, total, page: effectivePage }, error: null };
}

/** "Today's attendance count" (AC #2) -- counts every counted check-in today
 * regardless of open/closed state (Scope Note #4). Story 27.1: "today" is the
 * GYM-LOCAL day (the `gym_local_period_bounds()` instants, 0097), no longer the
 * UTC day -- for a Douala gym (UTC+1) a check-in between 00:00 and 01:00 local
 * used to count for yesterday. Reads `attendance_counted`, so a voided visit is
 * never counted. */
export async function getTodayAttendanceCount(): Promise<{ count: number; error: AppError | null }> {
  const supabase = await createClient();
  const { gymId, error: gymIdError } = await getCallerGymId(supabase);
  if (gymIdError || !gymId) {
    return { count: 0, error: gymIdError };
  }

  const { data: bounds, error: boundsError } = await getGymLocalPeriodBounds();
  if (boundsError || !bounds) {
    return { count: 0, error: boundsError };
  }

  const { count, error } = await supabase
    .from("attendance_counted")
    .select("id", { count: "exact", head: true })
    .eq("gym_id", gymId)
    .gte("checked_in_at", bounds.dayStart)
    .lt("checked_in_at", bounds.nextDayStart);

  if (error) {
    return { count: 0, error: await mapAndLog(error) };
  }
  return { count: count ?? 0, error: null };
}

export interface AttendanceLogRow extends AttendanceEntryInfo {
  id: string;
  memberId: string;
  memberName: string;
  checkedInAt: string;
  checkedOutAt: string | null;
  /** Set when the visit was voided (Story 27.3): the row stays in the log, muted, with the "Voided" pill and who/when/why. */
  voidedAt: string | null;
  voidedByLabel: string | null;
  voidReason: string | null;
}

/** Paginated Daily Log (AC #2, AD-11): `from`/`to` default to today's UTC
 * date when the caller passes neither (Scope Note #4). Ordered by
 * `checked_in_at` descending (newest first) -- matches AD-12 Audit Log's own
 * convention: this is a log, not the live roster.
 *
 * Story 27.3: read from `list_attendance_log` (the base-table policies of 0173 hide voided rows from staff, and the log shows them,
 * muted, by default). `memberSearch` filters the returned `member_name` (PostgREST filters apply to a function's rows). */
export async function listAttendanceLog(params: {
  page?: number;
  pageSize?: number;
  from?: string;
  to?: string;
  memberSearch?: string;
}): Promise<{ data: { rows: AttendanceLogRow[]; total: number; page: number } | null; error: AppError | null }> {
  const supabase = await createClient();
  const { gymId, error: gymIdError } = await getCallerGymId(supabase);
  if (gymIdError || !gymId) {
    return { data: null, error: gymIdError };
  }

  const requestedPage = params.page && params.page > 0 ? params.page : 1;
  const pageSize = parsePageSize(params.pageSize, ATTENDANCE_LOG_PAGE_SIZE);

  const today = todayUtcDate();
  // Review Finding: params.from/to come straight from URL search params and
  // are not guaranteed well-formed (hand-edited URL, cleared date input) --
  // resolveDateParam falls back to today rather than letting a bad string
  // reach dateEndExclusiveIso below and throw.
  const fromDate = resolveDateParam(params.from, today);
  const toDate = resolveDateParam(params.to, today);

  function buildQuery(page: number) {
    let q = supabase
      .rpc("list_attendance_log", { p_from: dateStartIso(fromDate), p_to: dateEndExclusiveIso(toDate) }, { count: "exact" })
      .order("checked_in_at", { ascending: false })
      .order("attendance_id", { ascending: true });

    if (params.memberSearch) {
      q = q.ilike("member_name", `%${escapeIlike(params.memberSearch)}%`);
    }

    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;
    return q.range(from, to);
  }

  const { data, count, error } = await buildQuery(requestedPage);
  if (error) {
    return { data: null, error: await mapAndLog(error) };
  }

  const total = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const mapRows = (rows: unknown): AttendanceLogRow[] =>
    ((rows ?? []) as unknown as AttendanceLogRpcRow[]).map((row) => ({
      id: row.attendance_id,
      memberId: row.member_id,
      memberName: row.member_name ?? "",
      checkedInAt: row.checked_in_at,
      checkedOutAt: row.checked_out_at,
      source: toSource(row.source),
      enteredByLabel: row.entered_by_label,
      voidable: row.voidable,
      consumedSession: row.consumed_session,
      earnedStamp: row.earned_stamp,
      voidedAt: row.voided_at,
      voidedByLabel: row.voided_by_label,
      voidReason: row.void_reason,
    }));

  // Review Finding: a stale/hand-edited page beyond the last valid page
  // otherwise returns zero rows with no way back -- clamp to the last page.
  if (requestedPage > totalPages) {
    const { data: clampedData, error: clampedError } = await buildQuery(totalPages);
    if (clampedError) {
      return { data: null, error: await mapAndLog(clampedError) };
    }
    return { data: { rows: mapRows(clampedData), total, page: totalPages }, error: null };
  }

  return { data: { rows: mapRows(data), total, page: requestedPage }, error: null };
}

// ============================================================================
// Story 27.3: staff check-in (AD-30) and the same-day void (AD-11 V1.8).
// ============================================================================

export type StaffCheckInOutcome =
  | "checked_in"
  | "checked_in_expiring_soon"
  | "checked_in_grace_period"
  | "rejected_expired"
  | "session_required"
  | "already_checked_in"
  | "refused_deactivated"
  | "refused_registration_fee_due"
  | "refused_no_plan"
  | "member_not_found";

/** The coded answer of `staff_check_in` (0175). A refusal is a normal return, never an error: only a suspended gym, a refused role
 * or a missing step-up come back as `error`. */
export interface StaffCheckInResult {
  outcome: StaffCheckInOutcome;
  attendanceId: string | null;
  checkedInAt: string | null;
  memberStatus: string | null;
  expiryDate: string | null;
  daysSinceExpiry: number | null;
  graceEndsOn: string | null;
  since: string | null;
  sessionAmount: number | null;
}

interface StaffCheckInRow {
  outcome: string;
  attendance_id: string | null;
  checked_in_at: string | null;
  member_status: string | null;
  expiry_date: string | null;
  days_since_expiry: number | null;
  grace_ends_on: string | null;
  since: string | null;
  session_amount: number | null;
}

/** Calls `staff_check_in(p_member_id)`. No time and no scan id exists on the function: the server stamps now(). A GymOS Support caller
 * must have a single-use grant issued first (the action does that); this function only makes the call. */
export async function staffCheckIn(
  memberId: string,
): Promise<{ data: StaffCheckInResult | null; error: AppError | null }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("staff_check_in", { p_member_id: memberId });
  const row = (Array.isArray(data) ? data[0] : data) as StaffCheckInRow | null | undefined;
  if (error || !row) {
    return { data: null, error: await mapAndLog(error ?? new Error("staff_check_in returned no row")) };
  }
  return {
    data: {
      outcome: row.outcome as StaffCheckInOutcome,
      attendanceId: row.attendance_id,
      checkedInAt: row.checked_in_at,
      memberStatus: row.member_status,
      expiryDate: row.expiry_date,
      daysSinceExpiry: row.days_since_expiry,
      graceEndsOn: row.grace_ends_on,
      since: row.since,
      sessionAmount: row.session_amount,
    },
    error: null,
  };
}

export type VoidStaffCheckInOutcome =
  | "voided"
  | "attendance_not_found"
  | "invalid_reason"
  | "already_voided"
  | "not_staff_entry"
  | "not_same_day"
  | "later_visit_relies";

export interface VoidStaffCheckInResult {
  outcome: VoidStaffCheckInOutcome;
  attendanceId: string | null;
  voidedAt: string | null;
  sessionReleased: boolean;
  stampRemoved: boolean;
  /** For `later_visit_relies`: every later visit that relies on the session was a staff entry (so "Void the later check-in first"). */
  laterIsStaffEntry: boolean;
}

interface VoidStaffCheckInRow {
  outcome: string;
  attendance_id: string | null;
  voided_at: string | null;
  session_released: boolean | null;
  stamp_removed: boolean | null;
  later_is_staff_entry: boolean | null;
}

export async function voidStaffCheckIn(
  attendanceId: string,
  reason: string,
): Promise<{ data: VoidStaffCheckInResult | null; error: AppError | null }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("void_staff_check_in", { p_attendance_id: attendanceId, p_reason: reason });
  const row = (Array.isArray(data) ? data[0] : data) as VoidStaffCheckInRow | null | undefined;
  if (error || !row) {
    return { data: null, error: await mapAndLog(error ?? new Error("void_staff_check_in returned no row")) };
  }
  return {
    data: {
      outcome: row.outcome as VoidStaffCheckInOutcome,
      attendanceId: row.attendance_id,
      voidedAt: row.voided_at,
      sessionReleased: row.session_released === true,
      stampRemoved: row.stamp_removed === true,
      laterIsStaffEntry: row.later_is_staff_entry === true,
    },
    error: null,
  };
}

// ---- the member search of the Check in a member modal (step 1) ----------------------------------------------------

/** AD-30: at most 8 rows are shown; one more is fetched to know whether to say "Showing the first 8". */
export const CHECK_IN_SEARCH_LIMIT = 8;

export interface CheckInSearchRow {
  id: string;
  name: string;
  phone: string | null;
  photoUrl: string | null;
  planName: string | null;
  /** The member's latest subscription status; null when there is no plan. */
  status: MemberSubscriptionStatus | null;
  deactivatedAt: string | null;
  /** The check-in time of a member already inside, from attendance_counted. Null for a GymOS Support caller (no read of it; the server
   * answers "already checked in" on submit). */
  insideSince: string | null;
}

interface CheckInSearchRowFromDb {
  id: string;
  name: string;
  phone: string | null;
  photo_url: string | null;
  deactivated_at: string | null;
  subscriptions: { created_at: string; status: MemberSubscriptionStatus; plans: { name: string } | { name: string }[] | null }[] | null;
}

const ACCENT_CLASSES: Record<string, string> = {
  a: "[aàáâãäåAÀÁÂÃÄÅ]",
  c: "[cçCÇ]",
  e: "[eèéêëEÈÉÊË]",
  i: "[iìíîïIÌÍÎÏ]",
  n: "[nñNÑ]",
  o: "[oòóôõöOÒÓÔÕÖ]",
  u: "[uùúûüUÙÚÛÜ]",
  y: "[yýÿYÝŸ]",
};

/** "Ange" -> a regular expression that matches "Angé", "ANGE" and "Ange" (accent-insensitive contains; the case is the `imatch`
 * operator's). Only letters, digits and spaces are copied into the pattern; every other character becomes a single-character wildcard
 * ("."), so nothing the user types can change the pattern's shape, and no backslash ever reaches PostgREST's quoted-value parser
 * (which treats a backslash as an escape and would drop it). */
export function accentInsensitivePattern(term: string): string {
  const folded = term.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  let out = "";
  for (const ch of folded.toLowerCase()) {
    if (ACCENT_CLASSES[ch]) out += ACCENT_CLASSES[ch];
    else if (/[a-z0-9]/.test(ch)) out += ch;
    else if (/\s/.test(ch)) out += " ";
    else out += ".";
  }
  return out;
}

/** The digits of a typed phone in any country-code form: "+237 6 70 11", "00237670..." and "670..." all search by their digits. */
export function phoneSearchDigits(term: string): string {
  let digits = term.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  return digits;
}

/** Needs 2 letters or 3 digits (UX AD-30). Anything shorter queries nothing. */
export function isSearchTermLongEnough(term: string): boolean {
  const trimmed = term.trim();
  const letters = trimmed.replace(/[^\p{L}]/gu, "").length;
  const digits = trimmed.replace(/\D/g, "").length;
  return letters >= 2 || digits >= 3;
}

/** Step 1 of the Check in a member modal: members of THIS gym only, matched on name (accent-insensitive contains) or phone (digits).
 * Deactivated members are returned too: the server answers R8 for them. A Pay-per-session member's row carries the plan name and never
 * a session count (the session is checked on confirm). */
export async function searchMembersForCheckIn(
  term: string,
): Promise<{ data: { rows: CheckInSearchRow[]; hasMore: boolean } | null; error: AppError | null }> {
  if (!isSearchTermLongEnough(term)) {
    return { data: { rows: [], hasMore: false }, error: null };
  }

  const supabase = await createClient();
  const { gymId, role, error: gymIdError } = await getCallerGymId(supabase);
  if (gymIdError || !gymId) {
    return { data: null, error: gymIdError };
  }

  const trimmed = term.trim();
  const clauses: string[] = [];
  const letters = trimmed.replace(/[^\p{L}]/gu, "").length;
  if (letters >= 2) {
    const pattern = accentInsensitivePattern(trimmed);
    if (pattern) clauses.push(`name.imatch."${pattern}"`);
  }
  const digits = phoneSearchDigits(trimmed);
  if (digits.length >= 3) {
    clauses.push(`phone.ilike."%${digits}%"`);
  }
  if (clauses.length === 0) {
    return { data: { rows: [], hasMore: false }, error: null };
  }

  const { data, error } = await supabase
    .from("members")
    .select("id, name, phone, photo_url, deactivated_at, subscriptions(created_at, status, plans(name))")
    .eq("gym_id", gymId)
    .eq("role", "member")
    .or(clauses.join(","))
    .order("name", { ascending: true })
    .limit(CHECK_IN_SEARCH_LIMIT + 1);

  if (error) {
    return { data: null, error: await mapAndLog(error) };
  }

  const found = (data ?? []) as unknown as CheckInSearchRowFromDb[];
  const hasMore = found.length > CHECK_IN_SEARCH_LIMIT;
  const page = found.slice(0, CHECK_IN_SEARCH_LIMIT);

  const inside = new Map<string, string>();
  if (page.length > 0 && role !== "support") {
    const { data: openRows } = await supabase
      .from("attendance_counted")
      .select("member_id, checked_in_at")
      .eq("gym_id", gymId)
      .is("checked_out_at", null)
      .in("member_id", page.map((row) => row.id));
    for (const row of (openRows ?? []) as { member_id: string; checked_in_at: string }[]) {
      inside.set(row.member_id, row.checked_in_at);
    }
  }

  return {
    data: {
      hasMore,
      rows: page.map((row) => {
        const latest = [...(row.subscriptions ?? [])].sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0))[0];
        const plan = Array.isArray(latest?.plans) ? latest?.plans[0] : latest?.plans;
        return {
          id: row.id,
          name: row.name,
          phone: row.phone,
          photoUrl: row.photo_url,
          planName: plan?.name ?? null,
          status: latest?.status ?? null,
          deactivatedAt: row.deactivated_at,
          insideSince: inside.get(row.id) ?? null,
        };
      }),
    },
    error: null,
  };
}
