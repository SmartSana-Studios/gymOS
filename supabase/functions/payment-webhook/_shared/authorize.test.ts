// Story 23-6b: the session id the edge function sends to authorize_action, so a GymOS Support actor is judged against the live gate of
// the session that made the request.
import { assertEquals } from "jsr:@std/assert@1";
import { authorizeAction, gymIdFromToken, sessionIdFromToken } from "./authorize.ts";

function b64url(value: unknown): string {
  return btoa(JSON.stringify(value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function requestWith(token: string | null): Request {
  return new Request("http://localhost/initiate/x", { headers: token ? { Authorization: `Bearer ${token}` } : {} });
}

Deno.test("sessionIdFromToken reads session_id from the bearer token payload", () => {
  const token = `${b64url({ alg: "HS256" })}.${b64url({ sub: "u1", session_id: "11111111-1111-1111-1111-111111111111" })}.sig`;
  assertEquals(sessionIdFromToken(requestWith(token)), "11111111-1111-1111-1111-111111111111");
});

Deno.test("sessionIdFromToken is null for no header, a malformed token or a token without a session", () => {
  assertEquals(sessionIdFromToken(requestWith(null)), null);
  assertEquals(sessionIdFromToken(requestWith("not-a-jwt")), null);
  assertEquals(sessionIdFromToken(requestWith(`${b64url({})}.${b64url({ sub: "u1" })}.sig`)), null);
  assertEquals(sessionIdFromToken(requestWith(`${b64url({})}.${b64url({ session_id: 7 })}.sig`)), null);
});

Deno.test("authorizeAction sends p_session (null when there is none) and denies on an error", async () => {
  const calls: Record<string, unknown>[] = [];
  const client = {
    rpc: (_fn: string, params: Record<string, unknown>) => {
      calls.push(params);
      return Promise.resolve({ data: [{ allowed: true, reason: "allowed", actor_role: "support" }], error: null });
    },
  };
  // deno-lint-ignore no-explicit-any
  const decision = await authorizeAction(client as any, "u1", "g1", "payment.initiate_staff", "sess-1", "g1");
  assertEquals(decision, { allowed: true, reason: "allowed", role: "support" });
  // deno-lint-ignore no-explicit-any
  await authorizeAction(client as any, "u1", "g1", "payment.initiate_staff");
  assertEquals(calls[0].p_session, "sess-1");
  assertEquals(calls[1].p_session, null);

  const failing = { rpc: () => Promise.resolve({ data: null, error: { message: "boom" } }) };
  // deno-lint-ignore no-explicit-any
  assertEquals((await authorizeAction(failing as any, "u1", "g1", "payment.initiate_staff", "sess-1")).allowed, false);
});

Deno.test("a support actor is allowed only on the gym in its own token (support_wrong_gym otherwise)", async () => {
  const client = {
    rpc: () => Promise.resolve({ data: [{ allowed: true, reason: "allowed", actor_role: "support" }], error: null }),
  };
  const token = `${b64url({})}.${b64url({ session_id: "s1", gym_id: "g1" })}.sig`;
  assertEquals(gymIdFromToken(requestWith(token)), "g1");
  // deno-lint-ignore no-explicit-any
  const same = await authorizeAction(client as any, "u1", "g1", "payment.initiate_staff", "s1", "g1");
  assertEquals(same.allowed, true);
  // deno-lint-ignore no-explicit-any
  const other = await authorizeAction(client as any, "u1", "g2", "payment.initiate_staff", "s1", "g1");
  assertEquals(other, { allowed: false, reason: "support_wrong_gym", role: "support" });
  // deno-lint-ignore no-explicit-any
  const none = await authorizeAction(client as any, "u1", "g1", "payment.initiate_staff", "s1", null);
  assertEquals(none.allowed, false);
});
