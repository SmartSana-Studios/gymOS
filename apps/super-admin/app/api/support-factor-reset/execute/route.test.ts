/** Story 23.11: the executor route is public in the proxy, so its bearer check is the whole gate. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: (...a: unknown[]) => rpc(...a),
    auth: { admin: { mfa: { listFactors: async () => ({ data: { factors: [] }, error: null }), deleteFactor: async () => ({ error: null }) } } },
  }),
}));
vi.mock("@/lib/mail", () => ({ sendMail: vi.fn(async () => ({ ok: true })) }));

import { GET, POST } from "./route";

const req = (auth?: string) =>
  new Request("https://portal.example/api/support-factor-reset/execute", { method: "POST", headers: auth ? { authorization: auth } : {} }) as never;

describe("support factor reset executor route", () => {
  beforeEach(() => {
    rpc.mockReset();
    process.env.CRON_SECRET = "s3cret";
    process.env.DASHBOARD_APP_URL = "https://owner.gymosapps.com";
  });
  afterEach(() => {
    delete process.env.CRON_SECRET;
  });

  it("refuses a call with no or a wrong secret before touching the database", async () => {
    expect((await POST(req())).status).toBe(401);
    expect((await POST(req("Bearer nope"))).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses everything when no secret is configured", async () => {
    delete process.env.CRON_SECRET;
    expect((await GET(req("Bearer "))).status).toBe(401);
    expect((await POST(req("Bearer undefined"))).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("runs the executor for the cron and returns counts only", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    const res = await GET(req("Bearer s3cret"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ claimed: 0, done: 0, failed: 0 });
    expect(rpc).toHaveBeenCalledWith("claim_support_factor_resets", { p_limit: 10 });
  });

  it("answers 500 with a code when the claim fails", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "down" } });
    const res = await POST(req("Bearer s3cret"));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("claim_failed");
  });
});
