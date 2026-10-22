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

/**
 * Story 23-6b: the session id of an already VERIFIED bearer token (verifyActor validated it with the auth server), read from the
 * token's payload. A GymOS Support actor is allowed only while the live gate holds for this session. Null when it cannot be read.
 */
export function sessionIdFromToken(req: Request): string | null {
  return stringClaim(req, "session_id");
}

/** The `gym_id` claim of an already verified bearer token, or null. A support session may act only on this gym. */
export function gymIdFromToken(req: Request): string | null {
  return stringClaim(req, "gym_id");
}

function stringClaim(req: Request, name: string): string | null {
  const token = bearerToken(req);
  if (!token) return null;
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(payload.length / 4) * 4, "="));
    const value = (JSON.parse(json) as Record<string, unknown>)[name];
    return typeof value === "string" ? value : null;
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
  sessionId: string | null = null,
  jwtGymId: string | null = null,
): Promise<AuthorizeDecision> {
  try {
    const { data, error } = await supabase.rpc("authorize_action", {
      p_actor: actorId,
      p_gym_id: gymId,
      p_capability: capability,
      p_session: sessionId,
    });
    const row = Array.isArray(data) ? data[0] : null;
    if (error || !row) return { allowed: false, reason: "authorization_unavailable", role: null };
    // Story 23-6b: a support session acts on exactly the gym in its own verified token, not on any other gym it is assigned to.
    if (row.allowed === true && row.actor_role === "support" && (jwtGymId === null || jwtGymId !== gymId)) {
      return { allowed: false, reason: "support_wrong_gym", role: "support" };
    }
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
