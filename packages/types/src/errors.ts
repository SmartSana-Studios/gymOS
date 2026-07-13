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
