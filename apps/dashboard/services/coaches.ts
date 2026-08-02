import { createClient } from "@/lib/supabase/server";
import { type AppError } from "@gymos/types";
import { mapAndLog } from "@/services/session";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getServerTranslation } from "@/lib/i18n/get-server-translation";

/** Shared by every "0 rows affected" (RLS-denied) / "no gym_id claim" branch
 * in this file -- same discipline as members.ts's memberNotFoundError /
 * plans.ts's planNotFoundError: `context` is logged server-side only, never
 * shown to the caller. */
async function coachNotFoundError(context: string): Promise<AppError> {
  console.warn(`[coaches] resolved to not_found: ${context}`);
  const { t } = await getServerTranslation(await getRequestLocale());
  return { code: "not_found", message: t("members.errors.coachNotFound") };
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
    return { gymId: null, error: await coachNotFoundError("no gym_id claim on caller's session") };
  }

  return { gymId, error: null };
}

export interface CoachRow {
  id: string;
  name: string;
}

/** Gym-scoped list of coach-role `members` rows, for the Assigned Coach
 * dropdown (AD-05). Reuses the existing `gym_staff_read_own_members` policy
 * (already permits any staff-role reader, including Manager/Owner, to see
 * coach rows) -- no new `members`-table RLS needed. */
export async function listCoaches(): Promise<{ data: CoachRow[] | null; error: AppError | null }> {
  const supabase = await createClient();
  const { gymId, error: gymIdError } = await getCallerGymId(supabase);
  if (gymIdError || !gymId) {
    return { data: null, error: gymIdError };
  }
  const { data, error } = await supabase
    .from("members")
    .select("id, name")
    .eq("gym_id", gymId)
    .eq("role", "coach")
    .is("deactivated_at", null)
    .order("name", { ascending: true });
  if (error) {
    return { data: null, error: await mapAndLog(error) };
  }
  return { data: data ?? [], error: null };
}

/** Thin `assign_coach()` RPC wrapper -- same shape as subscriptions.ts's
 * `confirmRenewal()`. No pre-validation duplicated here (the RPC self-checks
 * role/gym/existence). Also the "reassign" path -- there is no separate
 * unassign operation (Scope Notes). */
export async function assignCoach(
  memberId: string,
  coachId: string,
): Promise<{ data: { id: string } | null; error: AppError | null }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("assign_coach", {
    p_member_id: memberId,
    p_coach_id: coachId,
  });
  if (error || !data) {
    return { data: null, error: await mapAndLog(error) };
  }
  return { data: { id: data }, error: null };
}

export interface CoachAssignmentRow {
  id: string;
  coachId: string;
  coachName: string;
  startedAt: string;
  endedAt: string | null;
}

interface CoachAssignmentRowFromDb {
  id: string;
  coach_id: string;
  started_at: string;
  ended_at: string | null;
  // PostgREST's embed cardinality inference for an explicit-FK-name embed
  // isn't reflected in the query builder's inferred TS type here, so this
  // accepts both shapes rather than asserting the object-only case away.
  members: { name: string } | { name: string }[] | null;
}

function toCoachAssignmentRow(row: CoachAssignmentRowFromDb): CoachAssignmentRow {
  const coach = Array.isArray(row.members) ? row.members[0] : row.members;
  return {
    id: row.id,
    coachId: row.coach_id,
    coachName: coach?.name ?? "",
    startedAt: row.started_at,
    endedAt: row.ended_at,
  };
}

/** AC #3: a member's full coach assignment history, reverse-chronological.
 * `current` is the row where `ended_at is null` (if any) -- also included in
 * `history` (AC #3's "all past coach assignments are queryable" treats the
 * active assignment as part of the same list, not a separate concept).
 * Embeds the coach's name via the explicit `coach_id` FK constraint name
 * (`coach_assignments_coach_id_fkey`) -- `coach_assignments` has two FKs to
 * `members` (`member_id`, `coach_id`), so PostgREST needs the explicit
 * constraint name to disambiguate which one to embed. */
export async function getCoachAssignments(
  memberId: string,
): Promise<{
  data: { current: CoachAssignmentRow | null; history: CoachAssignmentRow[] } | null;
  error: AppError | null;
}> {
  const supabase = await createClient();
  const { gymId, error: gymIdError } = await getCallerGymId(supabase);
  if (gymIdError || !gymId) {
    return { data: null, error: gymIdError };
  }

  const { data, error } = await supabase
    .from("coach_assignments")
    .select("id, coach_id, started_at, ended_at, members!coach_assignments_coach_id_fkey(name)")
    .eq("gym_id", gymId)
    .eq("member_id", memberId)
    .order("started_at", { ascending: false });

  if (error) {
    return { data: null, error: await mapAndLog(error) };
  }

  const history = ((data ?? []) as unknown as CoachAssignmentRowFromDb[]).map(toCoachAssignmentRow);
  const current = history.find((row) => row.endedAt === null) ?? null;

  return { data: { current, history }, error: null };
}

// ============================================================================
// Story 5.2: Coach Portal -- Assigned Member List. `listAssignedMembers`
// queries `subscriptions_current` (0037), the same view `listSubscriptions`
// (subscriptions.ts) uses -- once 0040_coach_portal_member_list_rls.sql's RLS
// narrowing lands, a coach session querying this view is automatically
// scoped to exactly their assigned members via `security_invoker = true`, no
// app-side filter needed. Structurally mirrors `listSubscriptions` minus
// pagination (no AC/mockup calls for it -- a coach's caseload is a strict,
// pilot-scale subset of a single gym's roster) plus a `search` param (AD-14
// mockup's name-search box).
// ============================================================================

export interface CoachPortalMemberRow {
  memberId: string;
  memberName: string;
  planName: string;
  planType: string;
  status: "active" | "expiring_soon" | "grace_period" | "expired";
  expiryDate: string | null;
}

interface CoachPortalMemberRowFromDb {
  member_id: string;
  member_name: string;
  plan_name: string;
  plan_type: string;
  status: CoachPortalMemberRow["status"];
  expiry_date: string | null;
}

function toCoachPortalMemberRow(row: CoachPortalMemberRowFromDb): CoachPortalMemberRow {
  return {
    memberId: row.member_id,
    memberName: row.member_name,
    planName: row.plan_name,
    planType: row.plan_type,
    status: row.status,
    expiryDate: row.expiry_date,
  };
}

// Union of AC #2 ("sortable by name and plan") and the AD-14 mockup ("Name /
// Status / Expiry") -- wires up all four via the same click-to-sort header
// mechanism SubscriptionsPageClient.tsx already established.
const COACH_PORTAL_SORT_COLUMN_MAP: Record<string, string> = {
  name: "member_name",
  plan: "plan_name",
  status: "status",
  expiry: "expiry_date",
};

function resolveCoachPortalSortColumn(sort: string | undefined): string {
  return (sort && COACH_PORTAL_SORT_COLUMN_MAP[sort]) || COACH_PORTAL_SORT_COLUMN_MAP.name;
}

// Matches members.ts's own escapeIlike() convention -- escapes ILIKE
// metacharacters (%, _) plus the backslash escape character itself and
// double quotes, so a literal name containing these matches literally
// instead of acting as a wildcard.
function escapeIlike(value: string): string {
  return value.replace(/[\\%_"]/g, (char) => `\\${char}`);
}

/** AC #2/#3/#4: a coach's assigned member list, searchable and sortable, no
 * pagination. `.eq("gym_id", gymId)` is defense-in-depth (the view's
 * `security_invoker = true` plus this story's RLS narrowing is the real
 * enforcement) -- matches `listSubscriptions`'s own discipline of never
 * relying on RLS alone. `.is("deactivated_at", null)` matches the view's own
 * established filter convention (`listSubscriptions` uses the identical
 * clause) -- a deactivated member should not appear in a coach's active
 * caseload. Returns `data: []` for both the "no assignments at all" (AC #4)
 * and "search matched nothing" empty states -- the client (
 * CoachPortalPageClient.tsx) distinguishes them via whether `search` was
 * provided, the same way SubscriptionsPageClient.tsx distinguishes its own
 * empty-state variants. */
export async function listAssignedMembers(params: {
  search?: string;
  sort?: string;
  dir?: string;
}): Promise<{ data: CoachPortalMemberRow[] | null; error: AppError | null }> {
  const supabase = await createClient();
  const { gymId, error: gymIdError } = await getCallerGymId(supabase);
  if (gymIdError || !gymId) {
    return { data: null, error: gymIdError };
  }

  let query = supabase
    .from("subscriptions_current")
    .select("member_id, member_name, plan_name, plan_type, status, expiry_date")
    .eq("gym_id", gymId)
    .is("deactivated_at", null);

  if (params.search && params.search.trim()) {
    query = query.ilike("member_name", `%${escapeIlike(params.search.trim())}%`);
  }

  query = query.order(resolveCoachPortalSortColumn(params.sort), {
    ascending: params.dir !== "desc",
  });

  const { data, error } = await query;
  if (error) {
    return { data: null, error: await mapAndLog(error) };
  }

  return {
    data: ((data ?? []) as unknown as CoachPortalMemberRowFromDb[]).map(toCoachPortalMemberRow),
    error: null,
  };
}

// ============================================================================
// Story 5.3: Coach Portal -- Member Detail & Session Notes (AD-15, FR-054,
// FR-055).
// ============================================================================

export interface CoachPortalMemberDetail {
  memberId: string;
  memberName: string;
  phone: string | null;
  goal: string | null;
  experienceLevel: string | null;
  planName: string;
  planType: string;
  status: CoachPortalMemberRow["status"];
  expiryDate: string | null;
}

/** AC #1: a member's header fields for AD-15's detail view. Two independent
 * RLS-scoped reads combined into one row -- `members` (name/phone/goal/
 * experience_level, not carried by `subscriptions_current`) plus
 * `subscriptions_current` (Story 4.8's view, already used by
 * `listAssignedMembers`) for plan/status/expiry. Both reads are
 * independently scoped by `coach_read_assigned_members`/
 * `coach_read_assigned_subscriptions` (0040) -- an unassigned member yields
 * `null` from both, mapped to `coachNotFoundError` here, matching this
 * file's existing not-found discipline (never a data leak or a crash on a
 * direct URL to an unassigned member's id -- this story's implicit AC). */
export async function getMemberDetail(
  memberId: string,
): Promise<{ data: CoachPortalMemberDetail | null; error: AppError | null }> {
  const supabase = await createClient();
  const { gymId, error: gymIdError } = await getCallerGymId(supabase);
  if (gymIdError || !gymId) {
    return { data: null, error: gymIdError };
  }

  const { data: memberRow, error: memberError } = await supabase
    .from("members")
    .select("id, name, phone, goal, experience_level")
    .eq("id", memberId)
    .eq("gym_id", gymId)
    .is("deactivated_at", null)
    .maybeSingle();
  if (memberError) {
    return { data: null, error: await mapAndLog(memberError) };
  }
  if (!memberRow) {
    return { data: null, error: await coachNotFoundError(`member ${memberId} not found or not assigned`) };
  }

  const { data: subRow, error: subError } = await supabase
    .from("subscriptions_current")
    .select("plan_name, plan_type, status, expiry_date")
    .eq("member_id", memberId)
    .eq("gym_id", gymId)
    .is("deactivated_at", null)
    .maybeSingle();
  if (subError) {
    return { data: null, error: await mapAndLog(subError) };
  }
  if (!subRow) {
    return { data: null, error: await coachNotFoundError(`member ${memberId} has no subscription`) };
  }

  return {
    data: {
      memberId: memberRow.id,
      memberName: memberRow.name,
      phone: memberRow.phone,
      goal: memberRow.goal,
      experienceLevel: memberRow.experience_level,
      planName: subRow.plan_name,
      planType: subRow.plan_type,
      status: subRow.status,
      expiryDate: subRow.expiry_date,
    },
    error: null,
  };
}

export interface SessionNoteRow {
  id: string;
  coachId: string;
  coachName: string;
  noteText: string;
  createdAt: string;
  editedAt: string | null;
}

interface SessionNoteRowFromDb {
  id: string;
  coach_id: string;
  note_text: string;
  created_at: string;
  edited_at: string | null;
  // Same dual-shape acceptance as CoachAssignmentRowFromDb's own `members`
  // field above -- PostgREST's embed cardinality inference isn't reflected
  // in the query builder's inferred TS type here.
  members: { name: string } | { name: string }[] | null;
}

function toSessionNoteRow(row: SessionNoteRowFromDb): SessionNoteRow {
  const coach = Array.isArray(row.members) ? row.members[0] : row.members;
  return {
    id: row.id,
    coachId: row.coach_id,
    coachName: coach?.name ?? "",
    noteText: row.note_text,
    createdAt: row.created_at,
    editedAt: row.edited_at,
  };
}

/** AC #2/#3/#4: a member's session notes, reverse-chronological, no
 * pagination (matches `listAssignedMembers`'s own "pilot scale" precedent).
 * Embeds the author's name via the explicit `coach_id` FK constraint name
 * (`session_notes_coach_id_fkey`) -- `session_notes` has two FKs to
 * `members` (`member_id`, `coach_id`), same disambiguation
 * `getCoachAssignments`'s own `coach_assignments_coach_id_fkey` embed
 * needs. Per RLS (0041), this always returns only the caller's own notes on
 * a currently-assigned member for `coach` sessions -- no client-side author
 * filtering needed or added (AC #4's resolution, see 0041's own comment). */
export async function listSessionNotes(
  memberId: string,
): Promise<{ data: SessionNoteRow[] | null; error: AppError | null }> {
  const supabase = await createClient();
  const { gymId, error: gymIdError } = await getCallerGymId(supabase);
  if (gymIdError || !gymId) {
    return { data: null, error: gymIdError };
  }
  const { data, error } = await supabase
    .from("session_notes")
    .select("id, coach_id, note_text, created_at, edited_at, members!session_notes_coach_id_fkey(name)")
    .eq("gym_id", gymId)
    .eq("member_id", memberId)
    .order("created_at", { ascending: false });
  if (error) {
    return { data: null, error: await mapAndLog(error) };
  }
  return { data: ((data ?? []) as unknown as SessionNoteRowFromDb[]).map(toSessionNoteRow), error: null };
}

/** Thin `add_session_note()` RPC wrapper -- same shape as `assignCoach()`
 * above. No pre-validation duplicated here (the RPC self-checks role/gym/
 * assignment). */
export async function addSessionNote(
  memberId: string,
  noteText: string,
): Promise<{ data: { id: string } | null; error: AppError | null }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("add_session_note", {
    p_member_id: memberId,
    p_note_text: noteText,
  });
  if (error || !data) {
    return { data: null, error: await mapAndLog(error) };
  }
  return { data: { id: data }, error: null };
}

/** Thin `edit_session_note()` RPC wrapper. The RPC's own `coach_id`-scoped
 * `where` clause is AC #4's actual enforcement -- a coach editing a note
 * that isn't theirs matches zero rows server-side and raises, regardless of
 * what the client sends. */
export async function editSessionNote(
  noteId: string,
  noteText: string,
): Promise<{ data: null; error: AppError | null }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("edit_session_note", {
    p_note_id: noteId,
    p_note_text: noteText,
  });
  if (error) {
    return { data: null, error: await mapAndLog(error) };
  }
  return { data: null, error: null };
}
