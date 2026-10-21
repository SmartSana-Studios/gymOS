/** Story 23.9: the e-mail drain route is public in the proxy (it checks its own bearer secret); its neighbours are not. */
import { describe, expect, it, vi } from "vitest";

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({ auth: { getClaims: async () => ({ data: { claims: null } }) } }),
}));
vi.mock("../utils", () => ({ hasEnvVars: true }));

import { NextRequest } from "next/server";
import { updateSession } from "./proxy";

const call = (path: string) => updateSession(new NextRequest(new URL(path, "https://portal.example")));

describe("updateSession for a signed-out request", () => {
  it("lets the e-mail drain route through without a redirect", async () => {
    const res = await call("/api/email-outbox/drain");
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });

  it("still redirects a neighbouring path to the login page", async () => {
    for (const path of ["/api/email-outbox/other", "/api/email-outbox/drain/extra", "/gyms"]) {
      const res = await call(path);
      expect(res.status).toBe(307);
      expect(res.headers.get("location")).toContain("/auth/login");
    }
  });
});
