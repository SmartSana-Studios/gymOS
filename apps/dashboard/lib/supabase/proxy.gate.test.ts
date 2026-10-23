/**
 * Story 23-6b: the request-path gate in the dashboard proxy. Only GymOS Support holds a second factor here, so a JWT at aal2 is a
 * support session. Every such request -- page, Server Action POST, route handler, auth page -- goes through session_gate_touch once;
 * a locked / expired / unreadable answer signs the session out locally and redirects to /auth/login?expired=1 (fail closed); a
 * session whose gym is no longer assigned (or not chosen yet) goes to the picker.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

type Claims = Record<string, unknown> | null;
let claims: Claims;
let gateResult: { data: unknown; error: unknown } | "throw";
let assignedGyms: { data: unknown; error: unknown };
let recertOverdue: { data: unknown; error: unknown };
const gateCalls: Record<string, unknown>[] = [];
const getClaims = vi.fn(async () => ({ data: claims ? { claims } : null }));
const signOut = vi.fn(async () => ({ error: null }));
const userRpc = vi.fn(async (fn: string) => {
  if (fn === "list_own_support_gyms") return assignedGyms;
  if (fn === "support_recertification_overdue") return recertOverdue;
  return { data: null, error: null };
});

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn((_url: string, _key: string, opts: { cookies: { setAll: (c: { name: string; value: string; options?: object }[]) => void } }) => ({
    auth: {
      getClaims,
      signOut: vi.fn(async () => {
        await signOut();
        opts.cookies.setAll([{ name: "sb-test-auth-token", value: "", options: { maxAge: 0 } }]);
        return { error: null };
      }),
    },
    rpc: userRpc,
  })),
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    rpc: vi.fn(async (fn: string, params: Record<string, unknown>) => {
      gateCalls.push({ fn, ...params });
      if (gateResult === "throw") throw new Error("network");
      return gateResult;
    }),
  })),
}));
vi.mock("../utils", () => ({ hasEnvVars: true }));

const SUPPORT = { sub: "u1", aal: "aal2", session_id: "s1", app_role: "support", gym_id: "g1" };

function req(path: string, init?: ConstructorParameters<typeof NextRequest>[1]) {
  return new NextRequest(`http://localhost:3000${path}`, init);
}

beforeEach(() => {
  gateCalls.length = 0;
  getClaims.mockClear();
  signOut.mockClear();
  userRpc.mockClear();
  claims = { ...SUPPORT };
  gateResult = { data: [{ ok: true, reason: "ok" }], error: null };
  assignedGyms = { data: [{ gym_id: "g1", gym_name: "Gym One" }], error: null };
  recertOverdue = { data: false, error: null };
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://localhost:54321");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-key");
});

describe("proxy session gate", () => {
  it("lets a live support session through and calls the gate with the verified user and session", async () => {
    const { updateSession } = await import("./proxy");
    const res = await updateSession(req("/members"));
    expect(res.status).not.toBe(307);
    expect(gateCalls).toEqual([{ fn: "session_gate_touch", p_user: "u1", p_session: "s1" }]);
  });

  it("runs the gate for a Server Action POST", async () => {
    const { updateSession } = await import("./proxy");
    const res = await updateSession(req("/settings", { method: "POST", headers: { "next-action": "abc123", "content-type": "text/plain" }, body: "[]" }));
    expect(res.status).not.toBe(307);
    expect(gateCalls).toHaveLength(1);
  });

  it("runs the gate for a route handler, the auth pages and the picker (no path is exempt)", async () => {
    const { updateSession } = await import("./proxy");
    for (const path of ["/api/payments/export", "/auth/login", "/auth/mfa", "/support-gym", "/support-invite", "/privacy", "/api/cron/x", "/"]) {
      gateCalls.length = 0;
      await updateSession(req(path));
      expect(gateCalls, path).toHaveLength(1);
    }
  });

  it("does not run the gate (or touch the heartbeat) for the exact /api/version poll", async () => {
    const { updateSession } = await import("./proxy");
    const res = await updateSession(req("/api/version"));
    expect(res.status).not.toBe(307);
    expect(gateCalls).toHaveLength(0);
    // look-alikes are still gated
    await updateSession(req("/api/version/x"));
    expect(gateCalls).toHaveLength(1);
  });

  it("does not run the gate for a session below aal2 (staff hold no factor)", async () => {
    claims = { sub: "u2", aal: "aal1", session_id: "s2", app_role: "owner", gym_id: "g9" };
    const { updateSession } = await import("./proxy");
    const res = await updateSession(req("/members"));
    expect(res.status).not.toBe(307);
    expect(gateCalls).toHaveLength(0);
    expect(userRpc).not.toHaveBeenCalledWith("list_own_support_gyms");
  });

  it.each([
    ["locked", { data: [{ ok: false, reason: "locked" }], error: null }],
    ["session_expired", { data: [{ ok: false, reason: "session_expired" }], error: null }],
    ["no_session", { data: [{ ok: false, reason: "no_session" }], error: null }],
    ["an RPC error", { data: null, error: { message: "boom" } }],
    ["an empty answer", { data: [], error: null }],
    ["a malformed answer", { data: [{ reason: "ok" }], error: null }],
    ["a thrown error", "throw" as const],
  ])("denies and signs the session out on %s (fails closed)", async (_name, result) => {
    gateResult = result;
    const { updateSession } = await import("./proxy");
    const res = await updateSession(req("/members"));
    expect(res.status).toBe(307);
    const location = new URL(res.headers.get("location")!);
    expect(location.pathname).toBe("/auth/login");
    expect(location.searchParams.get("expired")).toBe("1");
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(res.cookies.get("sb-test-auth-token")?.value).toBe("");
  });

  it("denies when the service key is missing (fails closed)", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    const { updateSession } = await import("./proxy");
    const res = await updateSession(req("/members"));
    expect(res.status).toBe(307);
    expect(gateCalls).toHaveLength(0);
  });

  it("denies a token with no session id", async () => {
    claims = { ...SUPPORT, session_id: undefined };
    const { updateSession } = await import("./proxy");
    const res = await updateSession(req("/members"));
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location")!).searchParams.get("expired")).toBe("1");
  });
});

describe("proxy explicit gym", () => {
  it("sends a session whose gym is no longer assigned back to the picker", async () => {
    assignedGyms = { data: [{ gym_id: "g2", gym_name: "Gym Two" }], error: null };
    const { updateSession } = await import("./proxy");
    const res = await updateSession(req("/members?x=1"));
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/support-gym");
  });

  it("sends a session with no assignment at all back to the picker", async () => {
    assignedGyms = { data: [], error: null };
    const { updateSession } = await import("./proxy");
    const res = await updateSession(req("/payments"));
    expect(new URL(res.headers.get("location")!).pathname).toBe("/support-gym");
  });

  it("fails closed to the picker when the assignment list cannot be read", async () => {
    assignedGyms = { data: null, error: { message: "boom" } };
    const { updateSession } = await import("./proxy");
    const res = await updateSession(req("/payments"));
    expect(new URL(res.headers.get("location")!).pathname).toBe("/support-gym");
  });

  it("sends an aal2 session that has not chosen a gym yet to the picker, and leaves the picker and auth pages alone", async () => {
    claims = { sub: "u1", aal: "aal2", session_id: "s1" };
    const { updateSession } = await import("./proxy");
    const home = await updateSession(req("/"));
    expect(new URL(home.headers.get("location")!).pathname).toBe("/support-gym");
    for (const path of ["/support-gym", "/auth/mfa"]) {
      const res = await updateSession(req(path));
      expect(res.status, path).not.toBe(307);
    }
  });

  it("keeps cookies refreshed by getClaims on the picker redirect", async () => {
    claims = { sub: "u1", aal: "aal2", session_id: "s1" };
    const ssr = await import("@supabase/ssr");
    const create = ssr.createServerClient as unknown as ReturnType<typeof vi.fn>;
    const original = create.getMockImplementation()! as (...a: unknown[]) => unknown;
    create.mockImplementationOnce((url: string, key: string, opts: { cookies: { setAll: (c: { name: string; value: string; options?: object }[]) => void } }) => {
      const client = original(url, key, opts) as { auth: { getClaims: () => Promise<unknown> } };
      const inner = client.auth.getClaims;
      client.auth.getClaims = async () => {
        opts.cookies.setAll([{ name: "sb-refreshed", value: "new-token" }]);
        return inner();
      };
      return client;
    });
    const { updateSession } = await import("./proxy");
    const res = await updateSession(req("/payments"));
    expect(new URL(res.headers.get("location")!).pathname).toBe("/support-gym");
    expect(res.cookies.get("sb-refreshed")?.value).toBe("new-token");
  });

  it("does not look up assignments for the picker or the version poll", async () => {
    const { updateSession } = await import("./proxy");
    await updateSession(req("/support-gym"));
    await updateSession(req("/api/version"));
    expect(userRpc).not.toHaveBeenCalledWith("list_own_support_gyms");
  });
});
describe("proxy overdue recertification", () => {
  it("sends a support session whose recertification is overdue to the explanation page", async () => {
    recertOverdue = { data: true, error: null };
    const { updateSession } = await import("./proxy");
    const res = await updateSession(req("/members"));
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/support-recertification");
  });

  it("does not redirect again from the explanation page itself (no loop)", async () => {
    recertOverdue = { data: true, error: null };
    const { updateSession } = await import("./proxy");
    const res = await updateSession(req("/support-recertification"));
    expect(res.status).not.toBe(307);
    expect(userRpc).not.toHaveBeenCalledWith("support_recertification_overdue");
  });

  it("lets a support session that is not overdue through", async () => {
    const { updateSession } = await import("./proxy");
    const res = await updateSession(req("/members"));
    expect(res.status).not.toBe(307);
    expect(userRpc).toHaveBeenCalledWith("support_recertification_overdue");
  });

  it("does not ask for anyone who is not a support session (Owners and staff pay nothing)", async () => {
    claims = { sub: "u2", aal: "aal2", session_id: "s2", app_role: "owner", gym_id: "g1" };
    const { updateSession } = await import("./proxy");
    await updateSession(req("/members"));
    expect(userRpc).not.toHaveBeenCalledWith("support_recertification_overdue");
  });
});


describe("no gate exemption beyond the auth exemptions (scan)", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(join(here, "proxy.ts"), "utf8");

  it("the gate call sits between getClaims and every path exemption, and is conditioned on aal2 only", () => {
    const claimsAt = source.indexOf("await supabase.auth.getClaims()");
    const gateAt = source.indexOf("await sessionGateAllows(");
    const firstExemption = source.indexOf('request.nextUrl.pathname.startsWith("/login")');
    expect(claimsAt).toBeGreaterThan(-1);
    expect(gateAt).toBeGreaterThan(claimsAt);
    expect(gateAt).toBeLessThan(firstExemption);
    const between = source.slice(claimsAt, source.indexOf("if (claims?.aal"));
    expect(between).not.toMatch(/startsWith|pathname\s*(===|!==)/);
    expect(source).toMatch(/if \(claims\?\.aal === "aal2" && pathname !== "\/api\/version"\) \{\s*const allowed = await sessionGateAllows\(/);
  });

  it("the only unauthenticated path exemptions are the auth, cron, version, privacy and support link routes", () => {
    const exemptions = [...source.matchAll(/(?:!request\.nextUrl\.pathname\.startsWith\("([^"]+)"\)|request\.nextUrl\.pathname !== "([^"]+)")/g)].map((m) => m[1] ?? m[2]);
    expect(exemptions).toEqual([
      "/login",
      "/auth",
      "/api/cron/",
      "/api/version",
      "/privacy",
      "/support-invite",
      "/support-invite/",
      "/support-reset-cancel",
      "/support-reset-cancel/",
    ]);
  });

  it("the proxy matcher excludes only static assets, so every other request reaches the gate", () => {
    const proxySource = readFileSync(join(here, "..", "..", "proxy.ts"), "utf8");
    const matcher = proxySource.match(/"\/\(\(\?!([^"]+)\)\.\*\)"/)?.[1];
    expect(matcher).toBe("_next/static|_next/image|_next/webpack-hmr|favicon.ico|.*\\\\.(?:svg|png|jpg|jpeg|gif|webp)$");
  });
});
