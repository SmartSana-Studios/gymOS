/** Story 23.9: the drain route is public in the proxy, so its bearer check is the whole gate. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
const sendMail = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: (...a: unknown[]) => rpc(...a) }) }));
vi.mock("@/lib/mail", () => ({ sendMail: (...a: unknown[]) => sendMail(...a) }));

import { GET, POST } from "./route";

const req = (auth?: string) =>
  new Request("https://portal.example/api/email-outbox/drain", { method: "POST", headers: auth ? { authorization: auth } : {} }) as never;

describe("email outbox drain route", () => {
  beforeEach(() => {
    rpc.mockReset();
    sendMail.mockReset();
    process.env.CRON_SECRET = "s3cret";
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
    expect((await POST(req("Bearer "))).status).toBe(401);
    expect((await GET(req("Bearer undefined"))).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("drains the queue for the cron (GET) and the dashboard (POST) and returns counts only", async () => {
    rpc.mockImplementation(async (fn: string) =>
      fn === "claim_email_outbox" ? { data: [{ id: "1", recipient_email: "o@x.example", subject: "S", body: "B" }], error: null } : { data: null, error: null },
    );
    sendMail.mockResolvedValue({ ok: true });

    const res = await GET(req("Bearer s3cret"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ claimed: 1, sent: 1, failed: 0 });
    expect(sendMail).toHaveBeenCalledWith({ to: "o@x.example", subject: "S", text: "B" });
  });

  it("POST drains too", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    const res = await POST(req("Bearer s3cret"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ claimed: 0, sent: 0, failed: 0 });
  });

  it("a failed claim answers 500", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "down" } });
    const res = await POST(req("Bearer s3cret"));
    expect(res.status).toBe(500);
  });

  it("a rejected rpc answers 500 drain_failed, not an unhandled error", async () => {
    rpc.mockRejectedValue(new Error("network"));
    const res = await POST(req("Bearer s3cret"));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "drain_failed" });
  });
});
