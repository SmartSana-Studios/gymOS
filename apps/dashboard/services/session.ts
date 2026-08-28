import { createClient } from "@/lib/supabase/server";
import { mapSupabaseError, type AppError } from "@gymos/types";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getServerTranslation } from "@/lib/i18n/get-server-translation";
import type { Locale } from "@/lib/i18n/config";

/**
 * `mapSupabaseError` is a pure mapping utility in `packages/types` (no
 * console/logging -- that package targets ES2022 only, no DOM/Node lib, and
 * is consumed by non-Node environments too). Application code is
 * responsible for logging the original error when it maps to the generic
 * "unknown" fallback, since otherwise the original error is lost and
 * production failures become undebuggable. Per-app local copy -- not shared
 * across apps/dashboard and apps/super-admin (architecture's service-layer
 * boundary: services are not shared across apps directly).
 *
 * Async since Story 1.10: resolves the caller's locale (`getRequestLocale`)
 * once here rather than threading a `locale` parameter through every
 * Server Action/service function call chain in the app -- every existing
 * call site just gains an `await`.
 */
export async function mapAndLog(rawError: unknown): Promise<AppError> {
  const locale = await getRequestLocale();
  const mapped = mapSupabaseError(rawError, locale);
  if (mapped.code === "unknown") {
    console.error("[mapSupabaseError] unmapped error", rawError);
  }
  return mapped;
}

// Gym-scoped staff/member roles only (matches the `member_role` Postgres
// enum, 0001_extensions_and_enums.sql). Super Admin is a platform-level
// flag, never seen here -- (dashboard)/layout.tsx redirects a
// super_admin-only session before this type is ever relevant.
export type MemberRole = "member" | "coach" | "receptionist" | "manager" | "supervisor" | "owner";

// Only these roles have a place on apps/dashboard. "member" is a real,
// valid member_role value (the gym-customer role, mobile-app/phone-OTP
// auth) -- if a member-role account also happens to have an email/password
// credential and signs in here, it must not silently render an empty
// Sidebar with no nav items and no explanation (Review finding).
const STAFF_ROLES: readonly MemberRole[] = ["receptionist", "manager", "supervisor", "owner", "coach"];

export interface DashboardShellContext {
  gymId: string;
  gymName: string;
  /**
   * Story 9.3: the caller's own `members.id` -- needed by the Staff List's
   * Edit/Deactivate UI to detect "is this row the caller's own row" for
   * AD-16's self-edit-disables-Role-field and self-deactivation-hidden
   * rules. Null on the same failed/null-lookup case `memberName`'s own
   * comment below documents (a display nicety, not a security boundary --
   * the RPC's own self-edit/self-deactivation checks are the real
   * enforcement either way).
   */
  memberId: string | null;
  memberName: string;
  role: MemberRole;
  /**
   * Story 1.11: true until the owner completes the forced password-change
   * flow after a temp-password activation. `(dashboard)/layout.tsx` reads
   * this to redirect to `/auth/update-password` before any other route.
   */
  mustChangePassword: boolean;
  /**
   * Story 9.6: every gym the caller holds an *active* binding at, including
   * the current one -- the actual mechanism satisfying AC #3 ("no switcher
   * for single-gym"). Populated only when the caller holds 2+ distinct
   * active `gym_id` memberships; empty for the common single-gym case, so
   * the Sidebar's presence check is a trivial `length > 1`.
   */
  availableGyms: { gymId: string; gymName: string; role: MemberRole }[];
}

/**
 * Story 11.4: the distinct "your gym is suspended/deactivated" result --
 * deliberately not overloaded onto `data === null`, which already means
 * something else ("no valid gym-scoped staff session at all"). The layout
 * uses `role`/`isBillingSuspension` to pick between the Owner's Pay-Now
 * screen and the neutral "temporarily unavailable" screen every other case
 * gets.
 */
export interface DashboardSuspendedContext {
  gymName: string;
  role: MemberRole;
  /**
   * True only for `gyms.status === 'suspended'` (the billing-lapse state
   * Story 11.2/11.3 already round-trip). `'deactivated'` is a distinct,
   * more severe Super-Admin lifecycle action (0011) that
   * `initiate_saas_billing_payment()` (0072) already explicitly rejects --
   * showing the Owner a Pay-Now button that would just fail is worse than
   * the neutral screen, so a deactivated gym's Owner sees the same neutral
   * copy as every other role, not the billing-aware one.
   */
  isBillingSuspension: boolean;
  /**
   * Review finding: the suspended short-circuit previously skipped the
   * `users.must_change_password` read entirely, letting a temp-password
   * Owner reach the Pay-Now screen (including submitting a real payment)
   * without ever completing Story 1.11's forced password change. `users` is
   * not gym-scoped and carries no `tenant_active_gate` policy, so this read
   * is unaffected by the suspension gate.
   */
  mustChangePassword: boolean;
  /**
   * Review finding: `private.current_gym_status()` evaluates the session's
   * *currently claimed* gym, not each row's own `gym_id` -- so once that gym
   * is suspended, the ordinary `self_read_own_membership`-backed query
   * (`DashboardShellContext.availableGyms`'s own mechanism) returns zero
   * rows for *every* gym the caller belongs to, not just the suspended one.
   * Populated instead via `list_own_active_gym_memberships()` (0074), a
   * SECURITY DEFINER read mirroring `switch_active_gym()`'s own RLS bypass
   * -- same data `self_read_own_membership` would already expose for an
   * active gym, just available regardless of the current gym's status.
   */
  gymId: string;
  availableGyms: { gymId: string; gymName: string; role: MemberRole }[];
}


/**
 * Backs the (dashboard) route group's layout: gym name (Sidebar header),
 * the current user's own name (Sidebar footer -- see story Dev Notes on why
 * `members.name` is used instead of the never-populated `users.display_name`),
 * and role (straight from the `app_role` claim -- no DB round-trip needed,
 * since the claims hook is already the authoritative source).
 *
 * Claims are read first, synchronously, before the parallel gym/member
 * fetches start (Story 1.7's Review Findings: an unguarded `getUser()`/
 * `getClaims()` call inside a `Promise.all` can reject the whole batch on a
 * throw-prone SDK path -- reading claims outside the `Promise.all` avoids
 * that class of bug entirely here).
 */
export async function getDashboardShellContext(): Promise<{
  data: DashboardShellContext | null;
  error: AppError | null;
  suspended: DashboardSuspendedContext | null;
}> {
  const supabase = await createClient();
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();

  if (claimsError) {
    // A genuine auth-server error, not just "no session" -- worth mapping
    // and logging (Review finding: this branch previously also fired, via
    // mapAndLog(null), for the ordinary logged-out case below).
    return { data: null, error: await mapAndLog(claimsError), suspended: null };
  }

  if (!claimsData?.claims) {
    // Ordinary "not logged in" case -- not an error, nothing to log.
    return { data: null, error: null, suspended: null };
  }

  const claims = claimsData.claims as {
    sub: string;
    email?: string;
    gym_id?: string;
    app_role?: string;
  };

  const gymId = claims.gym_id;
  const role = claims.app_role as MemberRole | undefined;

  if (!gymId || !role || !STAFF_ROLES.includes(role)) {
    // No gym-scoped staff session -- either a super_admin-only claim set,
    // or a non-staff role (e.g. "member") that has no place on this
    // dashboard (Review finding). The caller's own layout guard is the
    // real gate; this is a defensive no-context result, not an error.
    return { data: null, error: null, suspended: null };
  }

  // Story 11.4: read gym name/status via the still-open "read own gym"
  // policy (0009) *before* the members lookup below, which the new
  // tenant_active_gate RESTRICTIVE policy (0073) denies outright for any
  // non-active gym. Short-circuiting here -- rather than letting that now-
  // gated query silently return empty and fall through to the existing
  // `!shell` -> redirect("/auth/login") branch in (dashboard)/layout.tsx --
  // is what keeps a suspended gym's Owner out of a login-redirect loop and
  // on the Pay-Now recovery screen instead.
  const gymStatusResult = await supabase.from("gyms").select("name, status").eq("id", gymId).single();

  if (gymStatusResult.error) {
    return { data: null, error: await mapAndLog(gymStatusResult.error), suspended: null };
  }

  if (gymStatusResult.data.status !== "active") {
    // Review finding: `users` is not gym-scoped and carries no
    // `tenant_active_gate` policy, so this read is unaffected by the
    // suspension gate above -- safe to run here even though the `members`
    // lookup below is not. `list_own_active_gym_memberships()` (0074) is a
    // SECURITY DEFINER RPC for the same reason `members` itself can't be
    // queried directly here (see `availableGyms`'s own doc comment above).
    const [userStatusResult, membershipsResult] = await Promise.all([
      supabase.from("users").select("must_change_password").eq("id", claims.sub).single(),
      supabase.rpc("list_own_active_gym_memberships"),
    ]);

    if (userStatusResult.error) {
      return { data: null, error: await mapAndLog(userStatusResult.error), suspended: null };
    }

    if (membershipsResult.error) {
      // Same "display nicety, not a security boundary" reasoning as the
      // active-path availableGyms computation below -- a failed lookup just
      // means no switcher shows on the suspended screen, it does not affect
      // any RLS-scoped access.
      console.error("[getDashboardShellContext] suspended-branch memberships lookup failed", membershipsResult.error);
    }

    return {
      data: null,
      error: null,
      suspended: {
        gymName: gymStatusResult.data.name,
        role,
        isBillingSuspension: gymStatusResult.data.status === "suspended",
        mustChangePassword: userStatusResult.data.must_change_password,
        gymId,
        availableGyms: (membershipsResult.data ?? []).map(
          (m: { gym_id: string; gym_name: string; role: string }) => ({
            gymId: m.gym_id,
            gymName: m.gym_name,
            role: m.role as MemberRole,
          }),
        ),
      },
    };
  }

  const [memberResult, userResult, allMembershipsResult] = await Promise.all([
    supabase
      .from("members")
      .select("id, name")
      .eq("gym_id", gymId)
      .eq("user_id", claims.sub)
      .is("deactivated_at", null)
      .maybeSingle(),
    supabase.from("users").select("must_change_password").eq("id", claims.sub).single(),
    // Story 9.6: unfiltered by gym_id (unlike memberResult above) -- covered by
    // the pre-existing self_read_own_membership RLS policy
    // (0013_dashboard_shell_self_read.sql), whose own comment already
    // anticipated this exact multi-gym read. This is the data layer's half of
    // AC #3 (Task 5's UI-side check just reads its length).
    supabase
      .from("members")
      .select("gym_id, role")
      .eq("user_id", claims.sub)
      .is("deactivated_at", null),
  ]);

  if (memberResult.error) {
    // A genuine DB/RLS error here was previously indistinguishable from
    // "no row found" (Review finding). Log it so it's not silently masked,
    // but still fall through to the email fallback below rather than
    // failing the whole shell -- the display name is a nicety, not a
    // security boundary (see the comment on memberName below).
    console.error("[getDashboardShellContext] members lookup failed", memberResult.error);
  }

  if (userResult.error) {
    // Unlike the member-name fallback below, `mustChangePassword` is a real
    // security gate (Story 1.11) -- a failed lookup must not silently fall
    // through to "false" (would let an owner who never changed their temp
    // password reach the dashboard). Every authenticated `users` row exists
    // via `handle_new_user()` (0003), so a genuine error here is a real
    // backend failure, treated the same as the gym lookup above.
    return { data: null, error: await mapAndLog(userResult.error), suspended: null };
  }

  // A failed/null member lookup is a display nicety, not a security
  // boundary -- RLS on every other table still enforces access correctly
  // regardless of what name renders in the corner. Fall back to the claims'
  // own email rather than erroring the whole shell (edge case: claims are
  // stale relative to a mid-session deactivation, or the query above failed).
  const { t } = await getServerTranslation(await getRequestLocale());
  const memberName = memberResult.data?.name ?? claims.email ?? t("sidebar.unknownUser");

  // Story 9.6: same "display nicety, not a security boundary" reasoning as
  // memberResult above -- a failed lookup here just means no switcher shows,
  // it does not affect what any RLS-scoped query returns.
  if (allMembershipsResult.error) {
    console.error("[getDashboardShellContext] memberships-across-gyms lookup failed", allMembershipsResult.error);
  }

  const memberships = allMembershipsResult.data ?? [];
  const distinctGymIds = [...new Set(memberships.map((m) => m.gym_id))];

  let availableGyms: DashboardShellContext["availableGyms"] = [];
  if (distinctGymIds.length > 1) {
    // Only fetched for the minority multi-gym case -- no extra round trip
    // for the common single-gym session. The new "read gyms of own active
    // memberships" RLS policy (0065) is what makes this return every
    // relevant row instead of just the current claims gym.
    const gymsResult = await supabase.from("gyms").select("id, name").in("id", distinctGymIds);
    if (gymsResult.error) {
      console.error("[getDashboardShellContext] available-gyms name lookup failed", gymsResult.error);
    } else {
      const gymNameById = new Map(gymsResult.data.map((g) => [g.id, g.name]));
      availableGyms = memberships
        .map((m) => ({
          gymId: m.gym_id,
          gymName: gymNameById.get(m.gym_id) ?? m.gym_id,
          role: m.role as MemberRole,
        }))
        .filter((g) => gymNameById.has(g.gymId));
    }
  }

  return {
    data: {
      gymId,
      gymName: gymStatusResult.data.name,
      memberId: memberResult.data?.id ?? null,
      memberName,
      role,
      mustChangePassword: userResult.data.must_change_password,
      availableGyms,
    },
    error: null,
    suspended: null,
  };
}

/**
 * Story 9.6: switches the caller's session to a different gym they hold an
 * active binding at. `switch_active_gym()` (0065) validates the binding
 * server-side (AC #4) -- this function only calls `refreshSession()` on
 * success, so a rejected switch never mints a token refresh for a change
 * that never actually happened server-side.
 *
 * Review finding: once the RPC succeeds, `active_gym_id` has already durably
 * changed -- a `refreshSession()` failure at that point must not be reported
 * the same way as an RPC rejection (nothing to roll back, and the DB-side
 * preference is already correct). Retried once before surfacing an error, so
 * a single transient network blip doesn't leave the user believing the
 * switch never happened when it actually did.
 */
export async function switchActiveGym(gymId: string): Promise<{ error: AppError | null }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("switch_active_gym", { p_gym_id: gymId });

  if (error) {
    return { error: await mapAndLog(error) };
  }

  let { error: refreshError } = await supabase.auth.refreshSession();
  if (refreshError) {
    ({ error: refreshError } = await supabase.auth.refreshSession());
  }
  if (refreshError) {
    return { error: await mapAndLog(refreshError) };
  }

  return { error: null };
}

/**
 * Persists the signed-in user's language preference (FR-015, Story 1.10).
 * Relies entirely on the `self_update_own_language` RLS policy + the
 * `protect_self_managed_user_columns` trigger
 * (0015_users_self_service_language_preference.sql) for authorization --
 * mirrors `updateGymSettings`'s reliance on RLS rather than an app-side
 * permission check.
 */
export async function updateLanguagePreference(
  locale: Locale,
): Promise<{ error: AppError | null }> {
  const supabase = await createClient();
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();

  if (claimsError) {
    return { error: await mapAndLog(claimsError) };
  }
  if (!claimsData?.claims?.sub) {
    // No session at all -- must be a real error, not `{error: null}`. A
    // silent "success" here would leave the UI believing the preference
    // saved when the DB was never touched.
    const { t } = await getServerTranslation(await getRequestLocale());
    return { error: { code: "unauthenticated", message: t("common.somethingWentWrong") } };
  }

  const { error } = await supabase
    .from("users")
    .update({ preferred_language: locale })
    .eq("id", claimsData.claims.sub as string);

  if (error) {
    return { error: await mapAndLog(error) };
  }
  return { error: null };
}
