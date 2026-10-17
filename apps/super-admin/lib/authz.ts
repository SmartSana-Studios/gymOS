import { PERMISSION_DENIED_CODE, type AppError } from "@gymos/types";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getServerTranslation } from "@/lib/i18n/get-server-translation";

/** Story 22.4: platform capabilities, all Super Admin only (private.capability_roles). */
export type PlatformCapability =
  | "platform.admin_access"
  | "platform.gym_create"
  | "platform.billing_retry"
  | "platform.super_admin_manage";

export type AuthorizeResult =
  | { ok: true; actorId: string }
  | { ok: false; error: AppError; /** Story 22.6: why it was denied, so a layout can tell aal2_required apart. */ reason: string };

async function denied(capability: string, actorId: string | null, reason: string): Promise<AuthorizeResult> {
  // Actor id, capability and reason only: never the token, a claim set or a secret.
  const event = { actorId, gymId: null, capability, reason };
  console.warn(`[authz] permission_denied ${JSON.stringify(event)}`);
  try {
    // Loaded on demand: only a denial pays for it, and unit tests that never deny never load it.
    const Sentry = await import("@sentry/nextjs");
    Sentry.captureMessage("authorization_denied", { level: "warning", extra: event });
  } catch {
    // Reporting must never turn a denial into a failure.
  }
  const { t } = await getServerTranslation(await getRequestLocale());
  return { ok: false, error: { code: PERMISSION_DENIED_CODE, message: t("errors.permissionDenied") }, reason };
}

/**
 * Live Super Admin check for a service-role path or page guard. The actor comes from a verified
 * session (`auth.getUser()`), and the decision reads users.is_super_admin from the database:
 * a stale `app_role` claim is never consulted. Fails closed on every error.
 */
export async function authorizePlatformAction(capability: PlatformCapability): Promise<AuthorizeResult> {
  let actorId: string | null = null;
  try {
    const supabase = await createClient();
    const { data: userData, error: userError } = await supabase.auth.getUser();
    actorId = userData?.user?.id ?? null;
    if (userError || !actorId) {
      return denied(capability, null, "no_session");
    }
    const { data, error } = await createAdminClient().rpc("authorize_action", {
      p_actor: actorId,
      p_gym_id: null,
      p_capability: capability,
    });
    const row = Array.isArray(data) ? data[0] : null;
    if (error || !row) {
      return denied(capability, actorId, "authorization_unavailable");
    }
    if (row.allowed !== true) {
      return denied(capability, actorId, String(row.reason ?? "denied"));
    }
    // Story 22.5: while the aal2 flag is on, every platform capability also needs an aal2 session.
    const aal = await requireSuperAdminAal2();
    if (!aal.ok) return aal;
    // Story 22.7: server-recorded session limits (8 h absolute, 30 min idle) while the flag is on.
    const gate = await touchSessionGate(supabase, actorId);
    if (!gate.ok) return denied(capability, actorId, gate.reason);
    return { ok: true, actorId };
  } catch {
    return denied(capability, actorId, "authorization_unavailable");
  }
}

/**
 * Story 22.5: second-factor level gate for Super Admin Server Actions. `ok` when the platform flag
 * `super_admin_aal2` is off; while it is on the session must be aal2. Fails closed (denied) when
 * the flag or the session level cannot be read.
 */
export async function requireSuperAdminAal2(): Promise<AuthorizeResult> {
  let actorId: string | null = null;
  try {
    const supabase = await createClient();
    const { data: userData } = await supabase.auth.getUser();
    actorId = userData?.user?.id ?? null;
    if (!actorId) return denied("platform.aal2", null, "no_session");
    const { data: required, error } = await createAdminClient().rpc("super_admin_aal2_required");
    if (error || typeof required !== "boolean") {
      return denied("platform.aal2", actorId, "flag_unavailable");
    }
    if (!required) return { ok: true, actorId };
    const { data: aal, error: aalError } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aalError || aal?.currentLevel !== "aal2") {
      return denied("platform.aal2", actorId, "aal2_required");
    }
    return { ok: true, actorId };
  } catch {
    return denied("platform.aal2", actorId, "authorization_unavailable");
  }
}

/**
 * Story 22.7: session-limit gate. Calls the VOLATILE `session_gate_touch` with the actor and the
 * session id from the verified token. Flag off: the database returns ok and writes nothing. A breach
 * or lock comes back as a row (the database has already removed the session); the local cookie is
 * cleared best effort. Fails closed.
 */
async function touchSessionGate(
  supabase: Awaited<ReturnType<typeof createClient>>,
  actorId: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    const { data: claimsData } = await supabase.auth.getClaims();
    const sessionId = (claimsData?.claims as { session_id?: unknown } | undefined)?.session_id;
    const { data, error } = await createAdminClient().rpc("session_gate_touch", {
      p_user: actorId,
      p_session: typeof sessionId === "string" ? sessionId : null,
    });
    const row = Array.isArray(data) ? data[0] : null;
    if (error || !row || typeof row.ok !== "boolean") return { ok: false, reason: "session_gate_unavailable" };
    if (row.ok) return { ok: true };
    try {
      await supabase.auth.signOut({ scope: "local" });
    } catch {
      // Cookies cannot always be written from a Server Component render; the session row is gone anyway.
    }
    return { ok: false, reason: row.reason === "locked" ? "account_locked" : "session_expired" };
  } catch {
    return { ok: false, reason: "session_gate_unavailable" };
  }
}

/**
 * Story 22.7: consume a step-up grant bound to (actor, action, subject) atomically. `true` when the
 * flag is off (step-up not required) or a fresh grant was consumed. Fails closed.
 */
export async function consumeStepUp(actorId: string, action: StepUpAction, subjectId: string): Promise<boolean> {
  try {
    const { data, error } = await createAdminClient().rpc("stepup_consume", {
      p_user: actorId,
      p_action: action,
      p_subject: subjectId,
    });
    return !error && data === true;
  } catch {
    return false;
  }
}

/** Story 22.7: the only actions that need a step-up (spec decision 2026-10-16). */
export type StepUpAction = "remove_super_admin_factor" | "create_super_admin" | "change_recovery_email" | "remove_recovery_email";
export const STEP_UP_REQUIRED_CODE = "step_up_required";
