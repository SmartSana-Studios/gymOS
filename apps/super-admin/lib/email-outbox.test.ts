/** Story 23.9: the e-mail queue worker sends through the existing mail helper and hands every result back to the database. */
import { describe, expect, it, vi } from "vitest";

import { bearerMatches, drainEmailOutbox, type OutboxClient } from "./email-outbox";

function client(rows: unknown[], claimError: { message: string } | null = null) {
  const calls: { fn: string; args?: Record<string, unknown> }[] = [];
  const c: OutboxClient = {
    rpc: async (fn, args) => {
      calls.push({ fn, args });
      if (fn === "claim_email_outbox") return { data: claimError ? null : rows, error: claimError };
      return { data: null, error: null };
    },
  };
  return { c, calls };
}
const ROW = (id: string) => ({ id, recipient_email: `${id}@x.example`, subject: "S", body: "B" });

describe("drainEmailOutbox", () => {
  it("sends each claimed row and reports each result to the database", async () => {
    const { c, calls } = client([ROW("a"), ROW("b")]);
    const send = vi.fn(async (m: { to: string }) => (m.to.startsWith("a") ? ({ ok: true } as const) : ({ ok: false, reason: "send_failed" } as const)));

    const result = await drainEmailOutbox(c, send);

    expect(result).toEqual({ claimed: 2, sent: 1, failed: 1 });
    expect(send).toHaveBeenCalledWith({ to: "a@x.example", subject: "S", text: "B" });
    expect(calls.filter((x) => x.fn === "finish_email_outbox").map((x) => x.args)).toEqual([
      { p_id: "a", p_sent: true, p_error: null },
      { p_id: "b", p_sent: false, p_error: "send_failed" },
    ]);
    expect(calls.at(-1)?.fn).toBe("record_email_outbox_run");
    expect(calls.at(-1)?.args).toMatchObject({ p_sent: 1, p_failed: 1 });
  });

  it("a mail helper that throws is a failed send, not a crash, and the other rows still go", async () => {
    const { c, calls } = client([ROW("a"), ROW("b")]);
    const send = vi.fn(async (m: { to: string }) => {
      if (m.to.startsWith("a")) throw new Error("boom");
      return { ok: true } as const;
    });

    const result = await drainEmailOutbox(c, send);

    expect(result).toEqual({ claimed: 2, sent: 1, failed: 1 });
    expect(calls.find((x) => x.fn === "finish_email_outbox")?.args).toEqual({ p_id: "a", p_sent: false, p_error: "send_failed" });
  });

  it("an empty queue sends nothing and writes no job_runs row", async () => {
    const { c, calls } = client([]);
    const send = vi.fn();
    expect(await drainEmailOutbox(c, send)).toEqual({ claimed: 0, sent: 0, failed: 0 });
    expect(send).not.toHaveBeenCalled();
    expect(calls.map((x) => x.fn)).toEqual(["claim_email_outbox"]);
  });

  it("a failed claim sends nothing", async () => {
    const { c } = client([], { message: "db down" });
    const send = vi.fn();
    expect((await drainEmailOutbox(c, send)).error).toBe("claim_failed");
    expect(send).not.toHaveBeenCalled();
  });

  it("an unconfigured mailer is reported as a failure with its reason (retried by the database)", async () => {
    const { c, calls } = client([ROW("a")]);
    await drainEmailOutbox(c, async () => ({ ok: false, reason: "not_configured" }));
    expect(calls.find((x) => x.fn === "finish_email_outbox")?.args).toMatchObject({ p_sent: false, p_error: "not_configured" });
  });
});

describe("drainEmailOutbox result recording", () => {
  it("a failing finish is counted as a failure and reported, never silently dropped", async () => {
    const calls: string[] = [];
    const c: OutboxClient = {
      rpc: async (fn) => {
        calls.push(fn);
        if (fn === "claim_email_outbox") return { data: [ROW("a")], error: null };
        if (fn === "finish_email_outbox") return { data: null, error: { message: "db down" } };
        return { data: null, error: null };
      },
    };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await drainEmailOutbox(c, async () => ({ ok: true }));

    expect(result).toEqual({ claimed: 1, sent: 1, failed: 1, unrecorded: 1 });
    expect(spy.mock.calls.flat().join(" ")).not.toContain("a@x.example");
    spy.mockRestore();
  });

  it("stops starting sends once the time budget is spent", async () => {
    const { c } = client([ROW("a"), ROW("b")]);
    const send = vi.fn(async () => ({ ok: true }) as const);
    const result = await drainEmailOutbox(c, send, 20, -1);
    expect(send).not.toHaveBeenCalled();
    expect(result.claimed).toBe(2);
  });
});

describe("bearerMatches", () => {
  it("accepts only the exact secret", () => {
    expect(bearerMatches("Bearer s3cret", "s3cret")).toBe(true);
    expect(bearerMatches("Bearer s3creT", "s3cret")).toBe(false);
    expect(bearerMatches("Bearer s3cret-longer", "s3cret")).toBe(false);
    expect(bearerMatches("s3cret", "s3cret")).toBe(false);
    expect(bearerMatches(null, "s3cret")).toBe(false);
  });

  it("fails closed when no secret is configured", () => {
    expect(bearerMatches("Bearer ", "")).toBe(false);
    expect(bearerMatches("Bearer anything", undefined)).toBe(false);
  });
});
