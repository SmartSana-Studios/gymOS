// Story 22.4: live authorization for the user-initiated routes (initiate, initiate-link) of the
// payment-webhook function. The provider-signed receive route never goes through here.
//
// The actor is derived from a VERIFIED JWT (GoTrue validates it via auth.getUser(token)), never
// from the request body. The decision itself is public.authorize_action (migration 0125): one SQL
// definition shared with the Node apps, so the two runtimes cannot diverge.
import type { SupabaseClient } from "@supabase/supabase-js";

export const PERMISSION_DENIED_CODE = "permission_denied";

export type EdgeCapability = "payment.initiate_own" | "payment.initiate_staff" | "billing.saas_pay";

export interface AuthorizeDecision {
  allowed: boolean;
  reason: string;
  role: string | null;
}

/** The bearer token of the request, or null. */
export function bearerToken(req: Request): string | null {
  const header = req.headers.get("Authorization") ?? req.headers.get("authorization");
  if (!header) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match ? match[1] : null;
}

/** Verified actor user id, or null when the JWT is missing, malformed, expired or revoked. */
export async function verifyActor(supabase: SupabaseClient, req: Request): Promise<string | null> {
  const token = bearerToken(req);
  if (!token) return null;
  try {
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user?.id) return null;
    return data.user.id;
  } catch {
    return null;
  }
}

/** Calls the shared decision. Any error fails closed (deny). */
export async function authorizeAction(
  supabase: SupabaseClient,
  actorId: string,
  gymId: string | null,
  capability: EdgeCapability,
): Promise<AuthorizeDecision> {
  try {
    const { data, error } = await supabase.rpc("authorize_action", {
      p_actor: actorId,
      p_gym_id: gymId,
      p_capability: capability,
    });
    const row = Array.isArray(data) ? data[0] : null;
    if (error || !row) return { allowed: false, reason: "authorization_unavailable", role: null };
    return {
      allowed: row.allowed === true,
      reason: String(row.reason ?? "denied"),
      role: row.actor_role ?? null,
    };
  } catch {
    return { allowed: false, reason: "authorization_unavailable", role: null };
  }
}

/** Structured denial log: actor, gym, capability and reason only; never the token or a secret. */
export function logDenied(
  route: string,
  actorId: string | null,
  gymId: string | null,
  capability: string,
  reason: string,
): void {
  console.warn(
    `payment-webhook: permission_denied ${JSON.stringify({ route, actorId, gymId, capability, reason })}`,
  );
}

export function permissionDeniedResponse(): Response {
  return new Response(JSON.stringify({ code: PERMISSION_DENIED_CODE }), {
    status: 403,
    headers: { "Content-Type": "application/json" },
  });
}
