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
  | { ok: false; error: AppError };

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
  return { ok: false, error: { code: PERMISSION_DENIED_CODE, message: t("errors.permissionDenied") } };
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
    return { ok: true, actorId };
  } catch {
    return denied(capability, actorId, "authorization_unavailable");
  }
}
