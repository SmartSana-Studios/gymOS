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
