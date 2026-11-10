/** Story 24-3: legacy `sb-<ref>-auth-token*` cookies are cleared and the user is sent once to sign-in. */
import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const claims = vi.hoisted(() => ({ value: null as object | null }));
vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(() => ({
    auth: {
      getClaims: async () => ({
        data: claims.value ? { claims: claims.value } : null,
      }),
    },
  })),
}));
vi.mock("../utils", () => ({ hasEnvVars: true }));

describe("updateSession legacy cookies (story 24-3)", () => {
  const req = (path: string, cookies: string) =>
    new NextRequest(`http://localhost:3000${path}`, {
      headers: { cookie: cookies },
    });
  const cleared = (res: Response) =>
    (res.headers.getSetCookie?.() ?? []).filter((c) => /Max-Age=0/i.test(c));

  it("legacy only: clears and redirects once to /auth/login?expired=1", async () => {
    claims.value = null;
    const { updateSession } = await import("./proxy");
    const res = await updateSession(
      req("/members", "sb-abc-auth-token.0=x; sb-abc-auth-token.1=y"),
    );
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/auth/login?expired=1");
    expect(cleared(res).length).toBe(2);
  });

  it("legacy only on /auth/* or an exempt path: clears, no redirect", async () => {
    claims.value = null;
    const { updateSession } = await import("./proxy");
    for (const p of ["/auth/login", "/api/version", "/privacy"]) {
      const res = await updateSession(req(p, "sb-abc-auth-token=x"));
      expect(res.status).not.toBe(307);
      expect(cleared(res).length).toBe(1);
    }
  });

  it("legacy plus new: clears legacy and continues", async () => {
    claims.value = { sub: "u1", aal: "aal1" };
    const { updateSession } = await import("./proxy");
    const res = await updateSession(
      req("/members", "sb-abc-auth-token=x; __Host-sb-auth=y"),
    );
    expect(res.headers.get("location")).toBeNull();
    expect(cleared(res).length).toBe(1);
  });
});
