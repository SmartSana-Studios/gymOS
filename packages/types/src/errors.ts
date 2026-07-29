import en from "./locales/en.json";
import fr from "./locales/fr.json";

export interface AppError {
  code: string;
  message: string;
}

export type ErrorLocale = "en" | "fr";

const ERROR_COPY: Record<ErrorLocale, typeof en.errors> = {
  en: en.errors,
  fr: fr.errors,
};

// Maps Postgres/Supabase errors to the exact user-facing copy from
// EXPERIENCE.md's Error States table. `message` is sourced from
// packages/types/src/locales/{en,fr}.json's `errors.*` keys (Story 1.10) --
// still a pure, side-effect-free function with no DOM/Node lib usage
// (locale JSON is a static import, not a dynamic fetch).
export function mapSupabaseError(error: unknown, locale: ErrorLocale = "en"): AppError {
  const copy = ERROR_COPY[locale] ?? ERROR_COPY.en;
  const pgErrorCode = (error as { code?: string } | null)?.code;
  const message = (error as { message?: string } | null)?.message ?? "";

  // Postgres unique_violation (23505) on the case-insensitive gym-name index
  // (0010_super_admin_gym_provisioning.sql).
  if (pgErrorCode === "23505" && message.includes("idx_gyms_name_unique")) {
    return {
      code: "gym_name_taken",
      message: copy.gymNameTaken,
    };
  }

  // Same pattern for the case-insensitive tier-name index
  // (0011_super_admin_tier_gym_lifecycle.sql). Deliberately no mapping for
  // gyms_tier_id_fkey's raw FK-violation on tier delete -- AC #2's friendly
  // "N gyms use this tier" copy requires the actual count, which only an
  // app-side pre-check (deleteTier) can produce; the FK constraint is the
  // race-window backstop, not the primary UX path.
  if (pgErrorCode === "23505" && message.includes("idx_tiers_name_unique")) {
    return {
      code: "tier_name_taken",
      message: copy.tierNameTaken,
    };
  }

  // Same pattern for the case-insensitive, gym-scoped plan-name index
  // (0017_membership_plan_configuration.sql). Backstops planNameExists'
  // app-layer check-then-insert race window in insertPlan/updatePlan.
  if (pgErrorCode === "23505" && message.includes("idx_plans_gym_name_unique")) {
    return {
      code: "plan_name_taken",
      message: copy.planNameTaken,
    };
  }

  // idx_members_active_gym_user (0003_members_and_users.sql): the same
  // user_id can only hold one *active* membership per gym at a time. The
  // DB-level backstop for "this phone already has an active membership at
  // this gym" -- distinct from the phone_exists GoTrue mapping below, which
  // stays owner_phone_taken-scoped (Story 2.3's find-or-create-by-phone flow
  // self-heals its own race window before this constraint would ever fire
  // for a brand-new phone).
  if (pgErrorCode === "23505" && message.includes("idx_members_active_gym_user")) {
    return {
      code: "member_already_active_at_gym",
      message: copy.memberPhoneTaken,
    };
  }

  // gyms_tier_id_fkey violated by *updating a gym's own* tier_id to point at
  // a tier that no longer exists (e.g. deleted concurrently between page
  // load and submit). Postgres's message reads `insert or update on table
  // "gyms" violates foreign key constraint "gyms_tier_id_fkey"` for this
  // direction -- distinct from the delete-blocked-by-reference direction
  // above (`update or delete on table "tiers" ...`), which stays
  // deliberately unmapped since deleteTier's own pre-check owns that path.
  if (
    pgErrorCode === "23503" &&
    message.includes("gyms_tier_id_fkey") &&
    message.startsWith('insert or update on table "gyms"')
  ) {
    return {
      code: "tier_not_found",
      message: copy.tierNotFound,
    };
  }

  // supabase.auth.admin.createUser's duplicate-email/-phone errors. GoTrue
  // returns a structured `code` field (confirmed via manual testing during
  // Story 1.5: e.g. `{"code":"phone_exists", "message":"Phone number
  // already registered by another user"}`) -- check that directly instead
  // of loosely string-matching `message`, which both misclassified unrelated
  // errors (any message containing "email" + "already") and never detected
  // a duplicate phone at all.
  if (pgErrorCode === "email_exists") {
    return {
      code: "owner_email_taken",
      message: copy.ownerEmailTaken,
    };
  }

  if (pgErrorCode === "phone_exists") {
    return {
      code: "owner_phone_taken",
      message: copy.ownerPhoneTaken,
    };
  }

  // enforce_member_cap's raise (0018_member_management.sql) -- the DB
  // trigger's own race-window backstop when the app-layer memberCountForGym
  // fast-fail (which builds the friendly "N/Max members" copy directly, see
  // apps/dashboard/locales' members.capReached) passes but a concurrent
  // INSERT already filled the last slot. No pg error `code` of its own
  // (plain plpgsql `raise exception`, not a constraint violation), so this
  // matches on message text like every other raise-based mapping here.
  if (message.includes("member cap reached for gym")) {
    return {
      code: "member_cap_reached",
      message: copy.memberCapReached,
    };
  }

  // enforce_subscription_expiry_matches_plan_type's two raises (0018) --
  // both share this generic fallback since the app layer (createMember's
  // server-side plan_type lookup) is expected to prevent a mismatched pair
  // from ever reaching the trigger; this only fires on a genuine race
  // (plan_type changed between lookup and insert) or a direct API call.
  if (
    message.includes("must not have an expiry_date") ||
    message.includes("requires an expiry_date")
  ) {
    return {
      code: "subscription_plan_mismatch",
      message: copy.subscriptionPlanMismatch,
    };
  }

  // renew_subscription()'s raises (0022_manual_renewal_reset.sql, Story
  // 3.2). Matched on the exact raise-text substrings to avoid colliding with
  // unrelated messages. `permission denied`, the reason-required raise, and
  // the no-existing-subscription raise are deliberately left unmapped here
  // (fall through to "unknown") -- all three are unreachable through this
  // story's own role-gated, Zod-validated call path, matching this file's
  // established precedent of leaving "shouldn't happen" DB-level backstops
  // unmapped (e.g. super_admin_job_failures()'s own permission-denied case).
  if (message.includes("renew_subscription:") && message.includes("not found")) {
    return {
      code: "member_not_found",
      message: copy.memberNotFound,
    };
  }

  if (message.includes("is deactivated and cannot be renewed")) {
    return {
      code: "member_deactivated",
      message: copy.memberDeactivated,
    };
  }

  // check_out_member()'s raises (0024/0025) -- unmapped until Story 3.6's
  // dashboard Check Out button needed friendly copy for them.
  if (message.includes("check_out_member:") && message.includes("not found")) {
    return {
      code: "member_not_found",
      message: copy.memberNotFound,
    };
  }

  if (message.includes("has no open check-in")) {
    return {
      code: "no_open_check_in",
      message: copy.noOpenCheckIn,
    };
  }

  // No console/logging call here: packages/types targets ES2022 only (no
  // DOM/Node lib -- consumed by both Next.js apps and, eventually, Expo),
  // and is meant to stay a pure, side-effect-free mapping utility. Callers
  // in application code are responsible for logging an "unknown" result
  // server-side before it reaches the user, since the original `error`
  // object is otherwise lost once mapped to this generic shape.
  return {
    code: "unknown",
    message: copy.unknown,
  };
}
