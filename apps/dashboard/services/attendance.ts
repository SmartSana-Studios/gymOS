import { createClient } from "@/lib/supabase/server";
import { type AppError } from "@gymos/types";
import { mapAndLog } from "@/services/session";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getServerTranslation } from "@/lib/i18n/get-server-translation";
import type { MemberSubscriptionStatus } from "@/services/members";

// AD-11's own spec value.
export const ATTENDANCE_LOG_PAGE_SIZE = 50;

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
): Promise<{ gymId: string | null; error: AppError | null }> {
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();

  if (claimsError) {
    return { gymId: null, error: await mapAndLog(claimsError) };
  }

  const gymId = (claimsData?.claims as { gym_id?: string } | undefined)?.gym_id;
  if (!gymId) {
    return { gymId: null, error: await attendanceNotFoundError("no gym_id claim on caller's session") };
  }

  return { gymId, error: null };
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

export interface CurrentlyCheckedInRow {
  memberId: string;
  name: string;
  checkedInAt: string;
  status: MemberSubscriptionStatus | "no_active_plan";
  deactivatedAt: string | null;
}

interface CurrentlyCheckedInRowFromDb {
  member_id: string;
  checked_in_at: string;
  members: { name: string; deactivated_at: string | null } | null;
}

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
 * "most recent subscription" result without relying on that nesting depth. */
export async function getCurrentlyCheckedIn(params: { page?: number } = {}): Promise<{
  data: { rows: CurrentlyCheckedInRow[]; total: number; page: number } | null;
  error: AppError | null;
}> {
  const supabase = await createClient();
  const { gymId, error: gymIdError } = await getCallerGymId(supabase);
  if (gymIdError || !gymId) {
    return { data: null, error: gymIdError };
  }

  const requestedPage = params.page && params.page > 0 ? params.page : 1;

  function buildQuery(page: number) {
    const from = (page - 1) * ATTENDANCE_LOG_PAGE_SIZE;
    const to = from + ATTENDANCE_LOG_PAGE_SIZE - 1;
    return supabase
      .from("attendance_events")
      .select(`member_id, checked_in_at, members!inner(name, deactivated_at)`, { count: "exact" })
      .eq("gym_id", gymId)
      .is("checked_out_at", null)
      .order("checked_in_at", { ascending: true })
      .range(from, to);
  }

  const { data, count, error } = await buildQuery(requestedPage);
  if (error) {
    return { data: null, error: await mapAndLog(error) };
  }

  const total = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / ATTENDANCE_LOG_PAGE_SIZE));

  let openRows = (data ?? []) as unknown as CurrentlyCheckedInRowFromDb[];
  let effectivePage = requestedPage;

  // Review Finding: a stale/hand-edited page beyond the last valid page
  // otherwise returns zero rows with no way back -- clamp to the last page
  // instead (mirrors the same fix in listAttendanceLog below).
  if (requestedPage > totalPages) {
    effectivePage = totalPages;
    const { data: clampedData, error: clampedError } = await buildQuery(totalPages);
    if (clampedError) {
      return { data: null, error: await mapAndLog(clampedError) };
    }
    openRows = (clampedData ?? []) as unknown as CurrentlyCheckedInRowFromDb[];
  }

  const memberIds = openRows.map((row) => row.member_id);

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
    memberId: row.member_id,
    name: row.members?.name ?? "",
    checkedInAt: row.checked_in_at,
    status: statusByMemberId.get(row.member_id) ?? "no_active_plan",
    deactivatedAt: row.members?.deactivated_at ?? null,
  }));

  return { data: { rows, total, page: effectivePage }, error: null };
}

/** "Today's attendance count" (AC #2) -- counts every check-in today
 * regardless of open/closed state (Scope Note #4), UTC calendar day. */
export async function getTodayAttendanceCount(): Promise<{ count: number; error: AppError | null }> {
  const supabase = await createClient();
  const { gymId, error: gymIdError } = await getCallerGymId(supabase);
  if (gymIdError || !gymId) {
    return { count: 0, error: gymIdError };
  }

  const today = todayUtcDate();
  const { count, error } = await supabase
    .from("attendance_events")
    .select("id", { count: "exact", head: true })
    .eq("gym_id", gymId)
    .gte("checked_in_at", dateStartIso(today))
    .lt("checked_in_at", dateEndExclusiveIso(today));

  if (error) {
    return { count: 0, error: await mapAndLog(error) };
  }
  return { count: count ?? 0, error: null };
}

export interface AttendanceLogRow {
  id: string;
  memberId: string;
  memberName: string;
  checkedInAt: string;
  checkedOutAt: string | null;
}

interface AttendanceLogRowFromDb {
  id: string;
  member_id: string;
  checked_in_at: string;
  checked_out_at: string | null;
  members: { name: string } | null;
}

/** Paginated Daily Log (AC #2, AD-11): `from`/`to` default to today's UTC
 * date when the caller passes neither (Scope Note #4). `memberSearch` uses
 * `members!inner(...)` (mirrors `listMembers`'s own `useInnerJoin` pattern)
 * so the name filter actually excludes non-matching parent rows -- the
 * default left-embed would otherwise leave every attendance_events row
 * visible regardless of the filter. Ordered by `checked_in_at` descending
 * (newest first) -- matches AD-12 Audit Log's own convention: this is a log,
 * not the live roster. */
export async function listAttendanceLog(params: {
  page?: number;
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

  const today = todayUtcDate();
  // Review Finding: params.from/to come straight from URL search params and
  // are not guaranteed well-formed (hand-edited URL, cleared date input) --
  // resolveDateParam falls back to today rather than letting a bad string
  // reach dateEndExclusiveIso below and throw.
  const fromDate = resolveDateParam(params.from, today);
  const toDate = resolveDateParam(params.to, today);

  function buildQuery(page: number) {
    const membersSelect = params.memberSearch ? "members!inner(name)" : "members(name)";
    let q = supabase
      .from("attendance_events")
      .select(`id, member_id, checked_in_at, checked_out_at, ${membersSelect}`, { count: "exact" })
      .eq("gym_id", gymId)
      .gte("checked_in_at", dateStartIso(fromDate))
      .lt("checked_in_at", dateEndExclusiveIso(toDate))
      .order("checked_in_at", { ascending: false });

    if (params.memberSearch) {
      const escaped = escapeIlike(params.memberSearch);
      q = q.ilike("members.name", `%${escaped}%`);
    }

    const from = (page - 1) * ATTENDANCE_LOG_PAGE_SIZE;
    const to = from + ATTENDANCE_LOG_PAGE_SIZE - 1;
    return q.range(from, to);
  }

  const { data, count, error } = await buildQuery(requestedPage);
  if (error) {
    return { data: null, error: await mapAndLog(error) };
  }

  const total = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / ATTENDANCE_LOG_PAGE_SIZE));

  const mapRows = (rows: unknown) =>
    ((rows ?? []) as unknown as AttendanceLogRowFromDb[]).map((row) => ({
      id: row.id,
      memberId: row.member_id,
      memberName: row.members?.name ?? "",
      checkedInAt: row.checked_in_at,
      checkedOutAt: row.checked_out_at,
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
