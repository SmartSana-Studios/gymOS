export interface AppError {
  code: string;
  message: string;
}

// Maps Postgres/Supabase errors to the exact user-facing copy from
// EXPERIENCE.md's Error States table. English-only for now — i18n (FR-016's
// CI gate) is Story 1.10's job; do not wire i18n keys here prematurely.
export function mapSupabaseError(error: unknown): AppError {
  const pgErrorCode = (error as { code?: string } | null)?.code;
  const message = (error as { message?: string } | null)?.message ?? "";

  // Postgres unique_violation (23505) on the case-insensitive gym-name index
  // (0010_super_admin_gym_provisioning.sql).
  if (pgErrorCode === "23505" && message.includes("idx_gyms_name_unique")) {
    return {
      code: "gym_name_taken",
      message: "A gym with this name already exists",
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
      message: "This email address is already registered",
    };
  }

  if (pgErrorCode === "phone_exists") {
    return {
      code: "owner_phone_taken",
      message: "This phone number is already registered",
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
    message: "Something went wrong on our end.",
  };
}
