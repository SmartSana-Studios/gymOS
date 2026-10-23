import { createClient } from "@/lib/supabase/server";
import { type AppError, parsePageSize } from "@gymos/types";
import { mapAndLog } from "@/services/session";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getServerTranslation } from "@/lib/i18n/get-server-translation";
import { MEMBERS_PAGE_SIZE, type MemberListRow, type MemberRowFromDb, applyMemberFilters, getCallerGymId, memberNotFoundError, toMemberListRow, usesSubscriptionInnerJoin } from "./members.shared";

/** Joins `members` to its most recent `subscriptions` row (order+limit on
 * the embedded resource) and to `plans.name`. A specific subscription-status
 * filter uses `subscriptions!inner(...)` so the filter actually excludes
 * non-matching top-level member rows (PostgREST's default embed is a left
 * join -- filtering a left-joined embed alone does not exclude the parent
 * row). Safe against this story's own data shape: a member here always has
 * at most one subscription row, so inner-vs-left makes no difference to
 * which member rows are visible, only to whether the filter applies. */
export async function listMembers(params: {
  search?: string;
  status?: string;
  page?: number;
  pageSize?: number;
}): Promise<{ data: { rows: MemberListRow[]; total: number } | null; error: AppError | null }> {
  const supabase = await createClient();
  const { gymId, error: gymIdError } = await getCallerGymId(supabase);
  if (gymIdError || !gymId) {
    return { data: null, error: gymIdError };
  }

  const page = params.page && params.page > 0 ? params.page : 1;
  const pageSize = parsePageSize(params.pageSize, MEMBERS_PAGE_SIZE);
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const useInnerJoin = usesSubscriptionInnerJoin(params.status);
  const subscriptionsSelect = useInnerJoin
    ? "subscriptions!inner(status, expiry_date, plan_id, created_at, plans(name, plan_type))"
    : "subscriptions(status, expiry_date, plan_id, created_at, plans(name, plan_type))";

  let query = supabase
    .from("members")
    .select(
      `id, name, phone, email, dob, photo_url, emergency_contact, birth_year, profession, neighborhood, join_date, deactivated_at, registration_fee_settled_at, ${subscriptionsSelect}`,
      { count: "exact" },
    )
    .eq("gym_id", gymId)
    .eq("role", "member")
    .order("name", { ascending: true })
    .order("created_at", { referencedTable: "subscriptions", ascending: false })
    .limit(1, { referencedTable: "subscriptions" });

  query = applyMemberFilters(query, params);
  query = query.range(from, to);

  const { data, count, error } = await query;

  if (error) {
    return { data: null, error: await mapAndLog(error) };
  }

  return {
    data: {
      rows: ((data ?? []) as unknown as MemberRowFromDb[]).map(toMemberListRow),
      total: count ?? 0,
    },
    error: null,
  };
}

/** Story 2.10: single-member fetch-by-id for `sendMemberInvite` -- no
 * existing function covers this (`listMembers` is a paginated list, not
 * fetch-by-id). Scoped by `gym_id` via `getCallerGymId()`, same as every
 * other function in this file; never trusts a client-supplied name/phone
 * (this file's established re-validation discipline, e.g. `createMember`).
 * Filters `role = "member"` (matches `listMembers`/`memberCountForGym`'s
 * established pattern -- `gym_staff_read_own_members` RLS (0018) grants
 * staff read access to every role in the gym, not just members, so this
 * app-layer filter is what actually stops a coach/manager/owner id from
 * reaching this lookup, code review fix) and `deactivated_at is null`
 * (mirrors the UI's own `!member.deactivatedAt` gate on the Send Invite
 * button -- code review fix, this function must not trust that client-side
 * gate). Returns `not_found` if the member doesn't belong to the caller's
 * gym, isn't an active `role = "member"` row, or has no phone -- all the
 * same "can't send an invite" outcome from the caller's perspective. */
export async function getMemberForInvite(
  memberId: string,
): Promise<{
  data: { name: string; phone: string; awaitingRegistrationFee: boolean } | null;
  error: AppError | null;
}> {
  const supabase = await createClient();
  const { gymId, error: gymIdError } = await getCallerGymId(supabase);
  if (gymIdError || !gymId) {
    return { data: null, error: gymIdError };
  }

  const { data, error } = await supabase
    .from("members")
    .select("name, phone, registration_fee_settled_at")
    .eq("gym_id", gymId)
    .eq("id", memberId)
    .eq("role", "member")
    .is("deactivated_at", null)
    .maybeSingle();

  if (error) {
    return { data: null, error: await mapAndLog(error) };
  }
  if (!data || !data.phone) {
    return {
      data: null,
      error: await memberNotFoundError(
        "0 rows or no phone for member invite lookup (non-manager/owner session, stale/cross-gym id, non-member role, deactivated member, or member.phone is null)",
      ),
    };
  }
  return {
    data: {
      name: data.name,
      phone: data.phone,
      // Story 18.5: the invite waits for settlement. role = 'member' is already
      // filtered above, so a null settled-at here means the fee is still owed.
      awaitingRegistrationFee: data.registration_fee_settled_at == null,
    },
    error: null,
  };
}

/** The fast-fail half of AC #2's cap check (Scope Note #4: counts every
 * row, no `deactivated_at is null` filter -- deactivating a member does not
 * free a slot). Reads the effective cap via
 * `supabase.rpc("gym_effective_member_cap")` (0018 migration) -- not a
 * direct `tiers` join, which no Manager/Owner SELECT policy permits (Scope
 * Note #7). This is the app-side mirror of `enforce_member_cap`'s own
 * DB-trigger logic, so `createMember`'s friendly error can show real
 * numbers ("You've reached your plan limit (30/30 members)") -- the trigger
 * remains the actual enforcement backstop either way. */
export async function memberCountForGym(): Promise<{
  count: number;
  cap: number | null;
  error: AppError | null;
}> {
  const supabase = await createClient();
  const { gymId, error: gymIdError } = await getCallerGymId(supabase);
  if (gymIdError || !gymId) {
    return { count: 0, cap: null, error: gymIdError };
  }

  const [{ count, error: countError }, { data: cap, error: capError }] = await Promise.all([
    supabase
      .from("members")
      .select("id", { count: "exact", head: true })
      .eq("gym_id", gymId)
      .eq("role", "member"),
    supabase.rpc("gym_effective_member_cap"),
  ]);

  if (countError) {
    return { count: 0, cap: null, error: await mapAndLog(countError) };
  }
  if (capError) {
    return { count: 0, cap: null, error: await mapAndLog(capError) };
  }

  return { count: count ?? 0, cap: cap ?? null, error: null };
}

/** Story 17.2 (AC #3, #7): the Overview's "New this month" card. Counts
 * `join_date` -- the business join date CSV import writes from the file --
 * not `created_at`, so a gym importing its roster in its first month does
 * not see all of it as new. `join_date` is a `date`: the bounds are the
 * gym-local YYYY-MM-DD strings from `getGymLocalPeriodBounds()`, the end
 * exclusive. `role = 'member'` is load-bearing (gym_staff_read_own_members
 * returns staff rows too). Deactivated members are deliberately NOT excluded:
 * this counts joins, not current headcount. Not `memberCountForGym()`, which
 * counts every member ever. */
export async function countMembersJoinedBetween(
  startDate: string,
  endDateExclusive: string,
): Promise<{ data: number | null; error: AppError | null }> {
  const supabase = await createClient();
  const { gymId, error: gymIdError } = await getCallerGymId(supabase);
  if (gymIdError || !gymId) {
    return { data: null, error: gymIdError };
  }

  const { count, error } = await supabase
    .from("members")
    .select("id", { count: "exact", head: true })
    .eq("gym_id", gymId)
    .eq("role", "member")
    .gte("join_date", startDate)
    .lt("join_date", endDateExclusive);

  if (error) {
    return { data: null, error: await mapAndLog(error) };
  }

  return { data: count ?? 0, error: null };
}

/** Story 18.5: what `assignInitialPlan` needs to know about a member before it
 * inserts the first subscription -- whether the member exists in the caller's
 * gym (as an active-or-not `role = 'member'` row) and whether it already has
 * any subscription row at all. Whether the registration fee is settled is not
 * read here: the 0098 gate on `subscriptions` is the authority and rejects an
 * awaiting member's insert. `gym_id` is applied on both reads as defence in
 * depth behind RLS, so an id from another gym resolves to `not_found`. */
export async function getMemberSubscriptionState(
  memberId: string,
): Promise<{ data: { gymId: string; hasSubscription: boolean } | null; error: AppError | null }> {
  const supabase = await createClient();
  const { gymId, error: gymIdError } = await getCallerGymId(supabase);
  if (gymIdError || !gymId) {
    return { data: null, error: gymIdError };
  }

  const { data: member, error: memberError } = await supabase
    .from("members")
    .select("id")
    .eq("gym_id", gymId)
    .eq("id", memberId)
    .eq("role", "member")
    .maybeSingle();
  if (memberError) {
    return { data: null, error: await mapAndLog(memberError) };
  }
  if (!member) {
    return {
      data: null,
      error: await memberNotFoundError("0 rows for the first-plan member lookup (stale/cross-gym id or non-member role)"),
    };
  }

  const { count, error: subscriptionError } = await supabase
    .from("subscriptions")
    .select("id", { count: "exact", head: true })
    .eq("gym_id", gymId)
    .eq("member_id", memberId);
  if (subscriptionError) {
    return { data: null, error: await mapAndLog(subscriptionError) };
  }

  return { data: { gymId, hasSubscription: (count ?? 0) > 0 }, error: null };
}

/** `createMember`'s server-side plan_type lookup -- the client never
 * supplies plan_type directly (it isn't a form field, Scope Note #6), but
 * the Server Action still needs it to validate whether `expiryDate` should
 * be present or absent before the DB trigger
 * (`enforce_subscription_expiry_matches_plan_type`, 0018) would otherwise
 * reject the insert with a raw Postgres error. Scoped to the caller's own
 * gym -- a planId from a different gym resolves to "not found," matching
 * `getPlan`'s (plans.ts) own scoping discipline. */
export async function getPlanTypeForGym(
  planId: string,
): Promise<{
  data: { planType: string; durationDays: number | null } | null;
  error: AppError | null;
}> {
  const supabase = await createClient();
  const { gymId, error: gymIdError } = await getCallerGymId(supabase);
  if (gymIdError || !gymId) {
    return { data: null, error: gymIdError };
  }

  const { data, error } = await supabase
    .from("plans")
    .select("plan_type, duration_days")
    .eq("gym_id", gymId)
    .eq("id", planId)
    .maybeSingle();

  if (error) {
    return { data: null, error: await mapAndLog(error) };
  }
  if (!data) {
    const { t } = await getServerTranslation(await getRequestLocale());
    return { data: null, error: { code: "plan_not_found", message: t("plans.errors.planNotFound") } };
  }
  return { data: { planType: data.plan_type, durationDays: data.duration_days ?? null }, error: null };
}

// Split by concern (Epic 20 retro G-2); callers and test mocks keep importing "@/services/members".
export { MEMBERS_PAGE_SIZE } from "./members.shared";
export type { MemberSubscriptionStatus, MemberListRow } from "./members.shared";
export { findOrCreateUserByPhone, deleteAuthUserForCleanup, insertMember, insertSubscription, deleteMemberForCleanup, provisionMemberRow } from "./members.provisioning";
export type { InsertMemberInput, InsertSubscriptionInput, ProvisionMemberRowInput } from "./members.provisioning";
export { updateMember, deactivateMember, logMemberChange } from "./members.changes";
export type { UpdateMemberInput } from "./members.changes";
export { exportMembersCsv } from "./members.export";
export type { ExportMembersCsvResult } from "./members.export";
export { getMemberRegistrationFeeState, getMemberListRow } from "./members.detail";
export type { MemberRegistrationFeeState } from "./members.detail";
