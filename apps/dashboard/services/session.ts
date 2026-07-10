import { createClient } from "@/lib/supabase/server";
import { mapSupabaseError, type AppError } from "@gymos/types";

/**
 * `mapSupabaseError` is a pure mapping utility in `packages/types` (no
 * console/logging -- that package targets ES2022 only, no DOM/Node lib, and
 * is consumed by non-Node environments too). Application code is
 * responsible for logging the original error when it maps to the generic
 * "unknown" fallback, since otherwise the original error is lost and
 * production failures become undebuggable. Per-app local copy -- not shared
 * across apps/dashboard and apps/super-admin (architecture's service-layer
 * boundary: services are not shared across apps directly).
 */
export function mapAndLog(rawError: unknown): AppError {
  const mapped = mapSupabaseError(rawError);
  if (mapped.code === "unknown") {
    console.error("[mapSupabaseError] unmapped error", rawError);
  }
  return mapped;
}

// Gym-scoped staff/member roles only (matches the `member_role` Postgres
// enum, 0001_extensions_and_enums.sql). Super Admin is a platform-level
// flag, never seen here -- (dashboard)/layout.tsx redirects a
// super_admin-only session before this type is ever relevant.
export type MemberRole = "member" | "coach" | "receptionist" | "manager" | "owner";

// Only these roles have a place on apps/dashboard. "member" is a real,
// valid member_role value (the gym-customer role, mobile-app/phone-OTP
// auth) -- if a member-role account also happens to have an email/password
// credential and signs in here, it must not silently render an empty
// Sidebar with no nav items and no explanation (Review finding).
const STAFF_ROLES: readonly MemberRole[] = ["receptionist", "manager", "owner", "coach"];

export interface DashboardShellContext {
  gymName: string;
  memberName: string;
  role: MemberRole;
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
}> {
  const supabase = await createClient();
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();

  if (claimsError) {
    // A genuine auth-server error, not just "no session" -- worth mapping
    // and logging (Review finding: this branch previously also fired, via
    // mapAndLog(null), for the ordinary logged-out case below).
    return { data: null, error: mapAndLog(claimsError) };
  }

  if (!claimsData?.claims) {
    // Ordinary "not logged in" case -- not an error, nothing to log.
    return { data: null, error: null };
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
    return { data: null, error: null };
  }

  const [gymResult, memberResult] = await Promise.all([
    supabase.from("gyms").select("name").eq("id", gymId).single(),
    supabase
      .from("members")
      .select("name")
      .eq("gym_id", gymId)
      .eq("user_id", claims.sub)
      .is("deactivated_at", null)
      .maybeSingle(),
  ]);

  if (gymResult.error) {
    return { data: null, error: mapAndLog(gymResult.error) };
  }

  if (memberResult.error) {
    // A genuine DB/RLS error here was previously indistinguishable from
    // "no row found" (Review finding). Log it so it's not silently masked,
    // but still fall through to the email fallback below rather than
    // failing the whole shell -- the display name is a nicety, not a
    // security boundary (see the comment on memberName below).
    console.error("[getDashboardShellContext] members lookup failed", memberResult.error);
  }

  // A failed/null member lookup is a display nicety, not a security
  // boundary -- RLS on every other table still enforces access correctly
  // regardless of what name renders in the corner. Fall back to the claims'
  // own email rather than erroring the whole shell (edge case: claims are
  // stale relative to a mid-session deactivation, or the query above failed).
  const memberName = memberResult.data?.name ?? claims.email ?? "Unknown User";

  return {
    data: {
      gymName: gymResult.data.name,
      memberName,
      role,
    },
    error: null,
  };
}
