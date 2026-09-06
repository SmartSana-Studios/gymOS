/**
 * Story 11.3: regression coverage for a real bug found via live-evidence
 * testing -- `updateSession()`'s unauthenticated-redirect check previously
 * had no exemption for `/api/cron/*` routes, so Vercel's own cron
 * invocation (genuinely unauthenticated at the session-cookie layer,
 * authenticated only via the route's own `CRON_SECRET` bearer check) would
 * be redirected to `/auth/login` before the route handler ever ran --
 * silently breaking the entire scheduled job in production. This file had
 * no prior test coverage at all; scoped narrowly to the exact regression
 * this story's fix closes, not a full `updateSession()` test suite.
 *
 * 2026-09-06: extended with the `/privacy` exemption, which has the same
 * shape of failure -- the published privacy policy must answer 200 to a
 * signed-out App Store/Play Console fetch, and a redirect to `/auth/login`
 * reads to a store reviewer as "no privacy policy". Like the cron case, it
 * is invisible from inside a logged-in browser session, which is the only
 * way this page is normally looked at during development.
 */
import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const getClaims = vi.fn(async () => ({ data: null }));

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(() => ({
    auth: { getClaims },
  })),
}));

vi.mock("../utils", () => ({
  hasEnvVars: true,
}));

describe("updateSession", () => {
  it("does not redirect an unauthenticated request to /api/cron/* routes", async () => {
    const { updateSession } = await import("./proxy");
    const request = new NextRequest("http://localhost:3000/api/cron/saas-billing-reminders");

    const response = await updateSession(request);

    expect(response.status).not.toBe(307);
    expect(response.headers.get("location")).toBeNull();
  });

  it("does not redirect an unauthenticated request to the published /privacy policy", async () => {
    const { updateSession } = await import("./proxy");
    const request = new NextRequest("http://localhost:3000/privacy");

    const response = await updateSession(request);

    expect(response.status).not.toBe(307);
    expect(response.headers.get("location")).toBeNull();
  });

  it("still redirects an unauthenticated request to an ordinary protected route (regression)", async () => {
    const { updateSession } = await import("./proxy");
    const request = new NextRequest("http://localhost:3000/settings");

    const response = await updateSession(request);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/auth/login");
  });
});
