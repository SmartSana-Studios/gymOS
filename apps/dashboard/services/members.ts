import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { type AppError } from "@gymos/types";
import { mapAndLog } from "@/services/session";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getServerTranslation } from "@/lib/i18n/get-server-translation";

// AD-03's own mockup page size -- deliberately not GYM_LIST_PAGE_SIZE (20,
// apps/super-admin), which is a different screen's own spec value.
export const MEMBERS_PAGE_SIZE = 25;

// FR-066's exact 1,000-row export ceiling.
const EXPORT_ROW_LIMIT = 1000;

/** Shared by every "0 rows affected" (RLS-denied) / "no gym_id claim" / "not
 * found" branch in this file -- same discipline as plans.ts's
 * planNotFoundError / gym-settings.ts's gymNotFoundError. `context` is
 * logged server-side only, never shown to the caller. */
async function memberNotFoundError(context: string): Promise<AppError> {
  console.warn(`[members] resolved to not_found: ${context}`);
  const { t } = await getServerTranslation(await getRequestLocale());
  return { code: "not_found", message: t("members.errors.memberNotFound") };
}

/** Every function in this file needs the caller's own `gym_id`, read from
 * claims -- copied verbatim from plans.ts/gym-settings.ts's own (unexported)
 * helper rather than reaching across service files, matching this app's
 * established per-file-copy discipline. Resolved internally by every
 * exported function below, never accepted as a parameter from the Server
 * Action layer. */
async function getCallerGymId(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<{ gymId: string | null; error: AppError | null }> {
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();

  if (claimsError) {
    return { gymId: null, error: await mapAndLog(claimsError) };
  }

  const gymId = (claimsData?.claims as { gym_id?: string } | undefined)?.gym_id;
  if (!gymId) {
    return { gymId: null, error: await memberNotFoundError("no gym_id claim on caller's session") };
  }

  return { gymId, error: null };
}

export type MemberSubscriptionStatus = "active" | "expiring_soon" | "grace_period" | "expired";

// The "no_active_plan" case is real (UX-DR5 lists it as a 6th badge state)
// even though this story never produces it directly -- a member created
// here always gets exactly one subscription. Represented in the type now so
// list rendering doesn't need a later breaking change; no code path in this
// story produces it.
export interface MemberListRow {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  dob: string | null;
  photoUrl: string | null;
  emergencyContact: string | null;
  planId: string | null;
  planName: string | null;
  planType: string | null;
  status: MemberSubscriptionStatus | "no_active_plan";
  expiryDate: string | null;
  joinDate: string;
  deactivatedAt: string | null;
}

interface MemberSubscriptionEmbed {
  status: MemberSubscriptionStatus;
  expiry_date: string | null;
  plan_id: string;
  created_at: string;
  plans: { name: string; plan_type: string } | null;
}

interface MemberRowFromDb {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  dob: string | null;
  photo_url: string | null;
  emergency_contact: string | null;
  join_date: string;
  deactivated_at: string | null;
  subscriptions: MemberSubscriptionEmbed[] | null;
}

// dob/photo_url/emergency_contact are selected here (not just id/name/
// phone/email/join_date/deactivated_at, AD-03's own list-column set)
// specifically so MemberModal's Edit mode can populate its identity-field
// form directly from the already-fetched list row, with no second
// round-trip to fetch a member's full detail.
function toMemberListRow(row: MemberRowFromDb): MemberListRow {
  const sub = row.subscriptions?.[0] ?? null;
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    email: row.email,
    dob: row.dob,
    photoUrl: row.photo_url,
    emergencyContact: row.emergency_contact,
    planId: sub?.plan_id ?? null,
    planName: sub?.plans?.name ?? null,
    planType: sub?.plans?.plan_type ?? null,
    status: sub?.status ?? "no_active_plan",
    expiryDate: sub?.expiry_date ?? null,
    joinDate: row.join_date,
    deactivatedAt: row.deactivated_at,
  };
}

// Escapes ilike's wildcard characters ('%', '_'), the escape character
// itself ('\') -- matches planNameExists/tierNameExists' exact escaping --
// and '"', since the result is always wrapped in double quotes below (a
// comma or parenthesis in a raw search term would otherwise be parsed by
// PostgREST's `.or()` as a condition separator/grouping character; quoting
// the value, per PostgREST's own quoted-value syntax, neutralizes both
// without needing to special-case them individually).
function escapeIlike(value: string): string {
  return value.replace(/[\\%_"]/g, (char) => `\\${char}`);
}

/** "Deactivated" is a `members`-level concept (deactivated_at is not null),
 * layered on top of the `subscriptions.status` enum, which has no
 * "deactivated" value of its own (Task 6's own note) -- callers pass one of
 * the four subscription_status values, "deactivated", or "" (all).
 *
 * `T` is preserved across the call (the caller's own PostgrestFilterBuilder
 * type, opaque here since this app's Supabase client carries no `Database`
 * generic, matching every other service file's own loosely-typed-client
 * discipline) -- the cast inside is required to invoke the chainable
 * `.or()/.not()/.is()/.eq()` methods without declaring their full,
 * unstable-across-supabase-js-versions signatures here. */
// The only values `subscriptions.status` (a Postgres enum) actually
// contains, plus this feature's "deactivated" pseudo-status (see
// memberLabels.ts's identical MemberBadgeStatus set) -- anything else in the
// `?status=` query param (hand-edited, stale link, etc.) would otherwise
// reach `.eq("subscriptions.status", ...)` below and raise a raw Postgres
// invalid-enum-value error, surfaced to the user as a generic load failure.
const VALID_STATUS_FILTERS = new Set([
  "active",
  "expiring_soon",
  "grace_period",
  "expired",
  "deactivated",
]);

function isValidStatusFilter(status: string | undefined): boolean {
  return Boolean(status && VALID_STATUS_FILTERS.has(status));
}

function applyMemberFilters<T>(
  query: T,
  params: { search?: string; status?: string },
): T {
  type ChainableFilter = {
    or(filters: string): ChainableFilter;
    not(column: string, operator: string, value: unknown): ChainableFilter;
    is(column: string, value: null): ChainableFilter;
    eq(column: string, value: unknown): ChainableFilter;
  };
  let next = query as unknown as ChainableFilter;
  if (params.search) {
    const escaped = escapeIlike(params.search);
    next = next.or(`name.ilike."%${escaped}%",phone.ilike."%${escaped}%"`);
  }
  const status = isValidStatusFilter(params.status) ? params.status : undefined;
  if (status === "deactivated") {
    next = next.not("deactivated_at", "is", null);
  } else if (status) {
    next = next.is("deactivated_at", null).eq("subscriptions.status", status);
  }
  return next as unknown as T;
}

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
}): Promise<{ data: { rows: MemberListRow[]; total: number } | null; error: AppError | null }> {
  const supabase = await createClient();
  const { gymId, error: gymIdError } = await getCallerGymId(supabase);
  if (gymIdError || !gymId) {
    return { data: null, error: gymIdError };
  }

  const page = params.page && params.page > 0 ? params.page : 1;
  const from = (page - 1) * MEMBERS_PAGE_SIZE;
  const to = from + MEMBERS_PAGE_SIZE - 1;

  const useInnerJoin = isValidStatusFilter(params.status) && params.status !== "deactivated";
  const subscriptionsSelect = useInnerJoin
    ? "subscriptions!inner(status, expiry_date, plan_id, created_at, plans(name, plan_type))"
    : "subscriptions(status, expiry_date, plan_id, created_at, plans(name, plan_type))";

  let query = supabase
    .from("members")
    .select(
      `id, name, phone, email, dob, photo_url, emergency_contact, join_date, deactivated_at, ${subscriptionsSelect}`,
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
): Promise<{ data: { planType: string } | null; error: AppError | null }> {
  const supabase = await createClient();
  const { gymId, error: gymIdError } = await getCallerGymId(supabase);
  if (gymIdError || !gymId) {
    return { data: null, error: gymIdError };
  }

  const { data, error } = await supabase
    .from("plans")
    .select("plan_type")
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
  return { data: { planType: data.plan_type }, error: null };
}

/** Scope Note #1's find-or-create-by-phone flow. Uses the Admin API client
 * -- `public.users` has no Manager/Owner SELECT policy that would let a
 * regular session look up a *different* user's row by phone
 * (`self_read_own_user`, 0015, is scoped to `id = auth.uid()` only), so this
 * lookup structurally requires elevated privilege regardless of the
 * `createUser` call below. `phone_confirm: false` (unlike `createGym`'s
 * owner-account precedent, which uses `true`) -- a member authenticates via
 * phone/OTP only, and their real first OTP verification in Story 2.6 is
 * what actually confirms the phone. */
export async function findOrCreateUserByPhone(
  phone: string,
): Promise<{ data: { userId: string; created: boolean } | null; error: AppError | null }> {
  const admin = createAdminClient();

  const { data: existing, error: lookupError } = await admin
    .from("users")
    .select("id")
    .eq("phone", phone)
    .maybeSingle();
  if (lookupError) {
    return { data: null, error: await mapAndLog(lookupError) };
  }
  if (existing) {
    return { data: { userId: existing.id, created: false }, error: null };
  }

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    phone,
    phone_confirm: false,
  });

  if (createError || !created?.user) {
    // Race window: another session created an auth.users row for this exact
    // brand-new phone a moment earlier. GoTrue reports this as a
    // `phone_exists` error -- self-heal by re-querying instead of
    // surfacing it as a failure (Scope Note #1), rather than a genuine
    // provisioning error.
    if ((createError as { code?: string } | null)?.code === "phone_exists") {
      const { data: reQueried, error: reQueryError } = await admin
        .from("users")
        .select("id")
        .eq("phone", phone)
        .maybeSingle();
      if (reQueryError) {
        return { data: null, error: await mapAndLog(reQueryError) };
      }
      if (reQueried) {
        // Not created by this call -- another session's request won the
        // race, so `created: false` here too (deleting it on a later
        // failure would be destructive to that other request).
        return { data: { userId: reQueried.id, created: false }, error: null };
      }
    }
    return { data: null, error: await mapAndLog(createError) };
  }

  return { data: { userId: created.user.id, created: true }, error: null };
}

/** Compensating cleanup for `createMember`'s orchestration: if `insertMember`
 * fails (cap-trigger race, RLS, unexpected error) after
 * `findOrCreateUserByPhone` freshly provisioned a brand-new `auth.users` row
 * in the same request (`created: true` -- never called when an existing
 * account was reused, which would make this destructive to that other
 * membership), delete that orphaned placeholder account rather than leave it
 * permanently unattached to any member. Mirrors `deleteMemberForCleanup`'s
 * same no-cross-table-transaction rationale. */
export async function deleteAuthUserForCleanup(userId: string): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) {
    console.error(
      `[members] compensating cleanup failed to delete auth user ${userId} after a failed member insert`,
      error,
    );
  }
}

export interface InsertMemberInput {
  name: string;
  phone: string;
  email: string | null;
  dob: string | null;
  photoUrl: string | null;
  emergencyContact: string | null;
  joinDate: string;
}

/** `members.role` is always 'member' for everything this function creates
 * -- enforced again at the RLS `with check` layer
 * (manager_or_owner_insert_own_members, 0018), not just here.
 * `members.phone` is a denormalized copy of `users.phone`/`auth.users.phone`
 * -- both get written at creation (mirrors `insertOwnerMember`'s existing
 * pattern), kept in sync at creation time only (Edit mode excludes phone
 * changes, so no drift-handling is needed here). */
export async function insertMember(
  userId: string,
  input: InsertMemberInput,
): Promise<{ data: { id: string; gymId: string } | null; error: AppError | null }> {
  const supabase = await createClient();
  const { gymId, error: gymIdError } = await getCallerGymId(supabase);
  if (gymIdError || !gymId) {
    return { data: null, error: gymIdError };
  }

  const { data, error } = await supabase
    .from("members")
    .insert({
      gym_id: gymId,
      user_id: userId,
      role: "member",
      name: input.name,
      phone: input.phone,
      email: input.email,
      dob: input.dob,
      photo_url: input.photoUrl,
      join_date: input.joinDate,
      emergency_contact: input.emergencyContact,
    })
    .select("id")
    .single();

  if (error || !data) {
    return { data: null, error: await mapAndLog(error) };
  }
  return { data: { id: data.id, gymId }, error: null };
}

export interface InsertSubscriptionInput {
  planId: string;
  status: MemberSubscriptionStatus;
  startDate: string;
  expiryDate: string | null;
}

/** `subscriptions.start_date` has no dedicated UI field in AD-05 -- set to
 * the same value as `join_date` at creation (a member's plan starts the day
 * they join). Enforced alongside the plan-type/expiry-date invariant by the
 * `enforce_subscription_expiry_matches_plan_type` trigger (0018) -- a
 * mismatched pair raises there, not here. */
export async function insertSubscription(
  gymId: string,
  memberId: string,
  input: InsertSubscriptionInput,
): Promise<{ data: { id: string } | null; error: AppError | null }> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("subscriptions")
    .insert({
      gym_id: gymId,
      member_id: memberId,
      plan_id: input.planId,
      status: input.status,
      start_date: input.startDate,
      expiry_date: input.expiryDate,
    })
    .select("id")
    .single();

  if (error || !data) {
    return { data: null, error: await mapAndLog(error) };
  }
  return { data, error: null };
}

/** Compensating cleanup for `createMember`'s own multi-step orchestration
 * (no cross-table transaction available via supabase-js, same accepted
 * limitation as `createGym`'s -- deferred-work.md's precedent for this exact
 * class of gap): if `insertSubscription` fails after `insertMember`
 * succeeds, delete the just-created `members` row so it isn't left
 * orphaned. Uses the Admin (service-role) client deliberately -- `members`
 * has no DELETE RLS policy at all (soft-delete only, FR-019), so this
 * narrowly-scoped cleanup-only delete structurally cannot go through the
 * regular session client. Does NOT delete the `auth.users` row even if one
 * was freshly provisioned in the same request -- `findOrCreateUserByPhone`
 * may have *reused* an existing account from another gym's membership;
 * deleting it would be destructive to that other membership. An orphaned
 * brand-new placeholder `auth.users` row is an accepted, logged edge case. */
export async function deleteMemberForCleanup(memberId: string): Promise<void> {
  const admin = createAdminClient();
  // subscriptions.member_id references members(id) with no ON DELETE CASCADE
  // -- the member delete below raises a foreign-key violation whenever a
  // subscription row was already committed (e.g. the CSV import batch
  // rollback undoing an earlier, fully-successful row, Scope Note #10). A
  // no-op when called from provisionMemberRow's own single-row cleanup,
  // where the subscription insert is what just failed.
  const { error: subscriptionError } = await admin.from("subscriptions").delete().eq("member_id", memberId);
  if (subscriptionError) {
    console.error(
      `[members] compensating cleanup failed to delete subscription for member ${memberId}`,
      subscriptionError,
    );
  }
  const { error } = await admin.from("members").delete().eq("id", memberId);
  if (error) {
    console.error(
      `[members] compensating cleanup failed to delete member ${memberId} after a failed subscription insert`,
      error,
    );
  }
}

export interface ProvisionMemberRowInput {
  name: string;
  phone: string;
  email: string | null;
  dob: string | null;
  photoUrl: string | null;
  emergencyContact: string | null;
  joinDate: string;
  planId: string;
  subscriptionStatus: MemberSubscriptionStatus;
  expiryDate: string | null;
}

/** Shared 3-step provisioning orchestration (find-or-create user by phone →
 * insert member → insert subscription, with compensating cleanup on
 * failure) -- extracted from `createMember`'s own inline Steps 3-5 (Story
 * 2.3) so both the single-create Server Action and this story's per-row CSV
 * import loop (Task 3, `confirmCsvImport`) share one implementation instead
 * of duplicating the delicate cleanup semantics. Pure relocation -- no
 * behavior change versus what `createMember` already did, including on the
 * subscription-insert failure path (deletes only the just-created member,
 * never a freshly-provisioned auth user -- `findOrCreateUserByPhone` may
 * have reused an existing account from another gym's membership, so
 * deleting it would be destructive to that other membership; an orphaned
 * brand-new placeholder `auth.users` row is an accepted, logged edge case,
 * same as before this extraction). `authUserCreated` on success (new to
 * this extraction, not part of `createMember`'s prior return shape) lets
 * the CSV import loop track which of its own successful rows would need a
 * compensating auth-user delete if a *later* row in the same batch fails
 * (Scope Note #10) -- `createMember` itself has no use for the flag and
 * simply discards it. `userId` is returned alongside for the same reason --
 * the CSV import loop's rollback needs the auth-user id to pass to
 * `deleteAuthUserForCleanup`, which `createMember` again has no use for. */
export async function provisionMemberRow(
  input: ProvisionMemberRowInput,
): Promise<{
  data: { id: string; userId: string; authUserCreated: boolean } | null;
  error: AppError | null;
}> {
  const { data: userResult, error: userError } = await findOrCreateUserByPhone(input.phone);
  if (userError || !userResult) {
    return { data: null, error: userError };
  }

  const { data: memberRow, error: memberError } = await insertMember(userResult.userId, {
    name: input.name,
    phone: input.phone,
    email: input.email,
    dob: input.dob,
    photoUrl: input.photoUrl,
    emergencyContact: input.emergencyContact,
    joinDate: input.joinDate,
  });
  if (memberError || !memberRow) {
    if (userResult.created) {
      await deleteAuthUserForCleanup(userResult.userId);
    }
    return { data: null, error: memberError };
  }

  const { error: subscriptionError } = await insertSubscription(memberRow.gymId, memberRow.id, {
    planId: input.planId,
    status: input.subscriptionStatus,
    startDate: input.joinDate,
    expiryDate: input.expiryDate,
  });
  if (subscriptionError) {
    await deleteMemberForCleanup(memberRow.id);
    return { data: null, error: subscriptionError };
  }

  return {
    data: { id: memberRow.id, userId: userResult.userId, authUserCreated: userResult.created },
    error: null,
  };
}

export interface UpdateMemberInput {
  name: string;
  email: string | null;
  dob: string | null;
  photoUrl: string | null;
  emergencyContact: string | null;
}

/** Edit-mode fields only (Scope Note's Edit-mode boundary) -- no phone,
 * plan, join date, subscription status, or expiry date. Chains
 * `.select().maybeSingle()` to confirm the update actually matched a row --
 * a non-manager/owner session's UPDATE (RLS-denied) or a stale/cross-gym
 * memberId would otherwise report a plain success despite touching nothing
 * (same pattern as `updatePlan`/`updateGymSettings`). */
export async function updateMember(
  memberId: string,
  input: UpdateMemberInput,
): Promise<{ error: AppError | null }> {
  const supabase = await createClient();
  const { gymId, error: gymIdError } = await getCallerGymId(supabase);
  if (gymIdError || !gymId) {
    return { error: gymIdError };
  }

  const { data, error } = await supabase
    .from("members")
    .update({
      name: input.name,
      email: input.email,
      dob: input.dob,
      photo_url: input.photoUrl,
      emergency_contact: input.emergencyContact,
    })
    .eq("gym_id", gymId)
    .eq("id", memberId)
    .select("id")
    .maybeSingle();

  if (error) {
    return { error: await mapAndLog(error) };
  }
  if (!data) {
    return { error: await memberNotFoundError("0 rows affected by member UPDATE (non-manager/owner session or stale/cross-gym id)") };
  }
  return { error: null };
}

/** AC #3: sets `members.deactivated_at = now()` AND the member's current
 * `subscriptions.status = 'expired'` -- two updates (no single-statement
 * multi-table update via supabase-js). Reason is not stored on either row
 * -- it lives in the audit_log metadata only (matches `changeGymStatus`'s
 * established pattern), written by `logMemberChange`'s caller. */
export async function deactivateMember(memberId: string): Promise<{ error: AppError | null }> {
  const supabase = await createClient();
  const { gymId, error: gymIdError } = await getCallerGymId(supabase);
  if (gymIdError || !gymId) {
    return { error: gymIdError };
  }

  const { data: memberRow, error: memberError } = await supabase
    .from("members")
    .update({ deactivated_at: new Date().toISOString() })
    .eq("gym_id", gymId)
    .eq("id", memberId)
    .select("id")
    .maybeSingle();

  if (memberError) {
    return { error: await mapAndLog(memberError) };
  }
  if (!memberRow) {
    return { error: await memberNotFoundError("0 rows affected by member deactivation UPDATE (non-manager/owner session or stale/cross-gym id)") };
  }

  // Compensating rollback shared by both failure points below: no
  // cross-table transaction available via supabase-js (same accepted
  // limitation as `deleteMemberForCleanup` above), so undo the
  // already-committed `deactivated_at` rather than leave the member marked
  // deactivated with a still-active subscription.
  async function rollbackDeactivation(cause: unknown): Promise<{ error: AppError | null }> {
    const { error: rollbackError } = await supabase
      .from("members")
      .update({ deactivated_at: null })
      .eq("gym_id", gymId)
      .eq("id", memberId);
    if (rollbackError) {
      console.error(
        `[members] deactivateMember rollback failed to restore member ${memberId} after a failed subscription lookup/UPDATE`,
        rollbackError,
      );
    }
    return { error: await mapAndLog(cause) };
  }

  // Story 3.2: a member can now have multiple `subscriptions` rows (renewal
  // history) -- only the current (most-recently-created) one should be
  // expired here, not every historical row, or deactivation would silently
  // rewrite a prior row's already-accurate historical status (e.g. a
  // `grace_period` row from before a renewal getting retroactively flipped
  // to `expired`). Mirrors the same "most recent subscription"
  // `.order(...).limit(1)` pattern already used by this file's own read
  // queries (~lines 219-220, 756-757). A member with zero subscription rows
  // (shouldn't happen in practice -- every member gets exactly one at
  // creation) is tolerated as a no-op, matching the original blanket
  // UPDATE's own implicit "0 rows matched" tolerance.
  const { data: currentSubscription, error: currentSubscriptionError } = await supabase
    .from("subscriptions")
    .select("id")
    .eq("gym_id", gymId)
    .eq("member_id", memberId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (currentSubscriptionError) {
    return rollbackDeactivation(currentSubscriptionError);
  }

  if (currentSubscription) {
    const { error: subscriptionError } = await supabase
      .from("subscriptions")
      .update({ status: "expired" })
      .eq("gym_id", gymId)
      .eq("id", currentSubscription.id);

    if (subscriptionError) {
      return rollbackDeactivation(subscriptionError);
    }
  }

  return { error: null };
}

export type ExportMembersCsvResult =
  | { data: string; error: null }
  | { data: null; error: AppError };

function csvEscape(value: string): string {
  // OWASP CSV-injection guard: a value starting with =, +, -, or @ is
  // interpreted as a formula by Excel/Sheets/etc. when the file is opened --
  // prefixing with a single quote forces those apps to render it as plain
  // text instead, without changing the value stored in the CSV cell itself.
  const safeValue = /^[=+\-@]/.test(value) ? `'${value}` : value;
  if (/[",\n\r]/.test(safeValue)) {
    return `"${safeValue.replace(/"/g, '""')}"`;
  }
  return safeValue;
}

/** FR-066's exact, explicit CSV column list (also referenced by AD-08's
 * Subscriptions export as "same column schema") -- not a judgment call.
 * `last_check_in_date` has no data source yet (`attendance_events` is Epic
 * 3) -- always an empty column, never a fabricated value. Reuses
 * `listMembers`'s exact filter logic but with no pagination: a
 * `count: "exact", head: true` pre-check first; if it exceeds
 * EXPORT_ROW_LIMIT, returns `export_too_large` without fetching any rows
 * (AD-03: "Apply a filter to narrow results"). */
export async function exportMembersCsv(params: {
  search?: string;
  status?: string;
}): Promise<ExportMembersCsvResult> {
  const supabase = await createClient();
  const { gymId, error: gymIdError } = await getCallerGymId(supabase);
  if (gymIdError || !gymId) {
    return { data: null, error: gymIdError ?? (await memberNotFoundError("no gymId or error from getCallerGymId in exportMembersCsv")) };
  }

  const useInnerJoin = isValidStatusFilter(params.status) && params.status !== "deactivated";
  const subscriptionsSelect = useInnerJoin
    ? "subscriptions!inner(status, expiry_date, plan_id, created_at, plans(name, plan_type))"
    : "subscriptions(status, expiry_date, plan_id, created_at, plans(name, plan_type))";

  let countQuery = supabase
    .from("members")
    .select(`id, ${subscriptionsSelect}`, { count: "exact", head: true })
    .eq("gym_id", gymId)
    .eq("role", "member");
  countQuery = applyMemberFilters(countQuery, params);

  const { count, error: countError } = await countQuery;
  if (countError) {
    return { data: null, error: await mapAndLog(countError) };
  }
  if ((count ?? 0) > EXPORT_ROW_LIMIT) {
    const { t } = await getServerTranslation(await getRequestLocale());
    return { data: null, error: { code: "export_too_large", message: t("members.errors.exportTooLarge") } };
  }

  let dataQuery = supabase
    .from("members")
    .select(`id, name, phone, email, join_date, deactivated_at, ${subscriptionsSelect}`)
    .eq("gym_id", gymId)
    .eq("role", "member")
    .order("name", { ascending: true })
    .order("created_at", { referencedTable: "subscriptions", ascending: false })
    .limit(1, { referencedTable: "subscriptions" });
  dataQuery = applyMemberFilters(dataQuery, params);
  dataQuery = dataQuery.range(0, EXPORT_ROW_LIMIT - 1);

  const { data, error } = await dataQuery;
  if (error) {
    return { data: null, error: await mapAndLog(error) };
  }

  // Matches CSV_TEMPLATE_COLUMNS' order (packages/types/src/schemas/csvImport.ts)
  // so a user exporting then re-importing their own file sees the same
  // column order, plus this export's own trailing last_check_in_date column
  // (not part of the import template).
  const header = [
    "member_name",
    "phone",
    "plan_type",
    "join_date",
    "subscription_status",
    "expiry_date",
    "last_check_in_date",
  ];
  const lines = [header.join(",")];

  for (const row of (data ?? []) as unknown as MemberRowFromDb[]) {
    const sub = row.subscriptions?.[0] ?? null;
    lines.push(
      [
        csvEscape(row.name),
        csvEscape(row.phone ?? ""),
        csvEscape(sub?.plans?.plan_type ?? ""),
        csvEscape(row.join_date),
        csvEscape(sub?.status ?? ""),
        csvEscape(sub?.expiry_date ?? ""),
        "", // last_check_in_date: no data source yet (attendance_events is Epic 3)
      ].join(","),
    );
  }

  return { data: lines.join("\r\n"), error: null };
}

/** Thin `log_audit_event` wrapper, following `logPlanChange`'s pattern:
 * same `{error}`-only return shape, same "audit write failed" console.error
 * + mapAndLog, same internally-resolved gym_id discipline. */
export async function logMemberChange(
  actionType: "member_created" | "member_edited" | "member_deactivated",
  memberId: string,
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
    p_target_entity_id: memberId,
    p_target_entity_type: "member",
    p_metadata: metadata,
  });

  if (error) {
    console.error(`[logMemberChange] audit log write failed for member ${memberId}`, error);
    return { error: await mapAndLog(error) };
  }
  return { error: null };
}
