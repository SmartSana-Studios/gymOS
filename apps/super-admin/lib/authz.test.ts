/** Story 22.4: the Super Admin app's live-authorization wrapper fails closed and never reads a claim. */
import { beforeEach, describe, expect, it, vi } from "vitest";

let userResult: { data: { user: { id: string } | null }; error: unknown };
let rpcResult: { data: unknown; error: unknown };
const rpcCalls: { fn: string; params: Record<string, unknown> }[] = [];
const getClaims = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ auth: { getUser: vi.fn(async () => userResult), getClaims } })),
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

import { authorizePlatformAction } from "./authz";

beforeEach(() => {
  rpcCalls.length = 0;
  getClaims.mockClear();
  userResult = { data: { user: { id: "sa-1" } }, error: null };
  rpcResult = { data: [{ allowed: true, reason: "allowed", actor_role: "super_admin" }], error: null };
});

describe("authorizePlatformAction", () => {
  it("allows a live Super Admin and never reads the token claims", async () => {
    const res = await authorizePlatformAction("platform.gym_create");
    expect(res).toEqual({ ok: true, actorId: "sa-1" });
    expect(rpcCalls[0].params).toEqual({ p_actor: "sa-1", p_gym_id: null, p_capability: "platform.gym_create" });
    expect(getClaims).not.toHaveBeenCalled();
  });

  it("flag off in the database: permission_denied even though the session may carry a stale claim", async () => {
    rpcResult = { data: [{ allowed: false, reason: "not_super_admin", actor_role: null }], error: null };
    const res = await authorizePlatformAction("platform.billing_retry");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("permission_denied");
  });

  it("no session or a failing RPC denies", async () => {
    userResult = { data: { user: null }, error: { message: "x" } };
    expect((await authorizePlatformAction("platform.admin_access")).ok).toBe(false);
    userResult = { data: { user: { id: "sa-1" } }, error: null };
    rpcResult = { data: null, error: { message: "boom" } };
    expect((await authorizePlatformAction("platform.admin_access")).ok).toBe(false);
  });
});
