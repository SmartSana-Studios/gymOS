/**
 * Story 22.4: the dashboard's live-authorization wrapper. The actor comes from a verified session
 * (getUser), the gym is the caller-supplied target row's gym when given, the decision is the
 * database's, and every failure mode denies with the stable permission_denied code.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

let userResult: { data: { user: { id: string } | null }; error: unknown };
let claimsResult: { data: { claims: Record<string, unknown> } | null };
let rpcResult: { data: unknown; error: unknown };
const rpcCalls: { fn: string; params: Record<string, unknown> }[] = [];
const getUserMock = vi.fn(async () => userResult);

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ auth: { getUser: getUserMock, getClaims: vi.fn(async () => claimsResult) } })),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({
    rpc: vi.fn(async (fn: string, params: Record<string, unknown>) => {
      rpcCalls.push({ fn, params });
      return rpcResult;
    }),
  })),
}));
vi.mock("@/lib/i18n/get-request-locale", () => ({ getRequestLocale: vi.fn(async () => "en") }));
vi.mock("@/lib/i18n/get-server-translation", () => ({
  getServerTranslation: vi.fn(async () => ({ t: (k: string) => k })),
}));
vi.mock("@sentry/nextjs", () => ({ captureMessage: vi.fn() }));

import { authorizeAction } from "./authz";

beforeEach(() => {
  rpcCalls.length = 0;
  userResult = { data: { user: { id: "actor-1" } }, error: null };
  claimsResult = { data: { claims: { gym_id: "gym-claim", app_role: "owner" } } };
  rpcResult = { data: [{ allowed: true, reason: "allowed", actor_role: "owner" }], error: null };
});

describe("authorizeAction", () => {
  it("allows and returns the live role; the actor is the verified user, the gym falls back to the claim as a hint", async () => {
    const res = await authorizeAction("staff.create");
    expect(res).toEqual({ ok: true, actorId: "actor-1", gymId: "gym-claim", role: "owner" });
    expect(rpcCalls[0]).toEqual({
      fn: "authorize_action",
      params: { p_actor: "actor-1", p_gym_id: "gym-claim", p_capability: "staff.create" },
    });
  });

  it("prefers the target row's gym over the claim", async () => {
    await authorizeAction("member.provision", { gymId: "gym-row" });
    expect(rpcCalls[0].params.p_gym_id).toBe("gym-row");
  });

  it("a database denial is permission_denied", async () => {
    rpcResult = { data: [{ allowed: false, reason: "deactivated", actor_role: null }], error: null };
    const res = await authorizeAction("staff.create");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("permission_denied");
  });

  it("no verified session is a denial and the database is never asked", async () => {
    userResult = { data: { user: null }, error: { message: "bad jwt" } };
    const res = await authorizeAction("staff.create");
    expect(res.ok).toBe(false);
    expect(rpcCalls).toHaveLength(0);
  });

  it("an RPC error or empty result fails closed", async () => {
    rpcResult = { data: null, error: { message: "boom" } };
    expect((await authorizeAction("staff.create")).ok).toBe(false);
    rpcResult = { data: [], error: null };
    expect((await authorizeAction("staff.create")).ok).toBe(false);
  });
});
