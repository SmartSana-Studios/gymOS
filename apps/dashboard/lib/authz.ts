import { PERMISSION_DENIED_CODE, type AppError } from "@gymos/types";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getServerTranslation } from "@/lib/i18n/get-server-translation";

/** Story 22.4: capabilities this app asks `public.authorize_action` about. The capability ->
 * allowed-roles allow-list lives in the database (private.capability_roles), in one place. */
export type DashboardCapability =
  | "staff.create"
  | "member.provision"
  | "member.registration_fee_state";

export type AuthorizeResult =
  | { ok: true; actorId: string; gymId: string; role: string }
  | { ok: false; error: AppError };

async function denied(
  capability: string,
  actorId: string | null,
  gymId: string | null,
  reason: string,
): Promise<AuthorizeResult> {
  // Actor id, gym id, capability and reason only: never the token, a claim set or a secret.
  const event = { actorId, gymId, capability, reason };
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
 * Live authorization for a service-role path. Call it BEFORE any admin-client use or provider call.
 *
 * The actor comes from a verified session (`auth.getUser()` validates the JWT with the auth
 * server), never from an argument. The gym is the target row's gym when the caller has one
 * (`opts.gymId`); otherwise it is the session's `gym_id` claim, used only as a hint: the
 * database verifies the actor holds a live membership in it. Fails closed on every error.
 */
export async function authorizeAction(
  capability: DashboardCapability,
  opts: { gymId?: string | null } = {},
): Promise<AuthorizeResult> {
  let actorId: string | null = null;
  let gymId: string | null = opts.gymId ?? null;
  try {
    const supabase = await createClient();
    const { data: userData, error: userError } = await supabase.auth.getUser();
    actorId = userData?.user?.id ?? null;
    if (userError || !actorId) {
      return denied(capability, null, gymId, "no_session");
    }

    if (!gymId) {
      const { data: claimsData } = await supabase.auth.getClaims();
      gymId = (claimsData?.claims as { gym_id?: string } | undefined)?.gym_id ?? null;
    }

    const admin = createAdminClient();
    const { data, error } = await admin.rpc("authorize_action", {
      p_actor: actorId,
      p_gym_id: gymId,
      p_capability: capability,
    });
    const row = Array.isArray(data) ? data[0] : null;
    if (error || !row) {
      return denied(capability, actorId, gymId, "authorization_unavailable");
    }
    if (row.allowed !== true) {
      return denied(capability, actorId, gymId, String(row.reason ?? "denied"));
    }
    return { ok: true, actorId, gymId: gymId as string, role: String(row.actor_role ?? "") };
  } catch {
    return denied(capability, actorId, gymId, "authorization_unavailable");
  }
}
