import { describe, expect, it, vi } from "vitest";

import { executeDueFactorResets, generateResetCancelToken, supportResetCancelLink, supportResetInviteMail, type ResetExecutorClient } from "./support-reset";

const ORIGIN = "https://owner.gymosapps.com";
const ROW = { reset_id: "r1", user_id: "u1", email: "sup@gymosapps.com" };

function makeClient(opts: { claim?: unknown; claimError?: boolean; factors?: { id: string }[]; listError?: boolean; deleteError?: boolean; issueError?: boolean; done?: unknown } = {}) {
  const calls: [string, Record<string, unknown> | undefined][] = [];
  const deleteFactor = vi.fn(async () => ({ error: opts.deleteError ? { message: "x" } : null }));
  const client = {
    rpc: vi.fn(async (fn: string, args?: Record<string, unknown>) => {
      calls.push([fn, args]);
      if (fn === "claim_support_factor_resets") return opts.claimError ? { data: null, error: { message: "x" } } : { data: opts.claim ?? [ROW], error: null };
      if (fn === "issue_support_reset_invite") return { data: "2026-10-22T00:00:00Z", error: opts.issueError ? { message: "x" } : null };
      if (fn === "support_factor_reset_done") return { data: opts.done ?? true, error: null };
      return { data: null, error: null };
    }),
    auth: { admin: { mfa: { listFactors: vi.fn(async () => (opts.listError ? { data: null, error: { message: "x" } } : { data: { factors: opts.factors ?? [{ id: "f1" }] }, error: null })), deleteFactor } } },
  } as unknown as ResetExecutorClient;
  return { client, calls, deleteFactor };
}
const names = (calls: [string, unknown][]) => calls.map(([n]) => n);

describe("reset token and link", () => {
  it("makes a 64-hex token, different every time, and a link on the configured origin", () => {
    const a = generateResetCancelToken();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(generateResetCancelToken()).not.toBe(a);
    expect(supportResetCancelLink(ORIGIN, a)).toBe(`${ORIGIN}/support-reset-cancel?t=${a}`);
  });

  it("the invite mail explains the reset and carries the link only (no password, no code)", () => {
    const mail = supportResetInviteMail({ link: "https://x.example/support-invite?t=abc" });
    expect(mail.text).toContain("previous authenticator was removed");
    expect(mail.text).toContain("authentificateur précédent");
    expect(mail.text.split("https://x.example/support-invite?t=abc").length - 1).toBe(2);
    expect(mail.subject).toContain(" / ");
  });
});

describe("executeDueFactorResets", () => {
  it("removes the factor, issues the invite, mails it and reports done, in that order", async () => {
    const m = makeClient({ factors: [{ id: "f1" }, { id: "f2" }] });
    const send = vi.fn(async () => ({ ok: true as const }));
    const res = await executeDueFactorResets(m.client, send, ORIGIN);
    expect(res).toEqual({ claimed: 1, done: 1, failed: 0 });
    expect(m.deleteFactor).toHaveBeenCalledTimes(2);
    expect(names(m.calls)).toEqual(["claim_support_factor_resets", "issue_support_reset_invite", "support_factor_reset_done", "record_support_factor_reset_run"]);
    const issue = m.calls.find(([n]) => n === "issue_support_reset_invite")![1] as { p_token: string };
    expect(issue.p_token).toMatch(/^[0-9a-f-]{36}\.[0-9a-f]{64}$/);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ to: "sup@gymosapps.com", text: expect.stringContaining(`${ORIGIN}/support-invite?t=`) }));
    expect(m.calls.find(([n]) => n === "support_factor_reset_done")![1]).toEqual({ p_reset_id: "r1", p_factors_removed: 2 });
  });

  it("a failed mail hands the reset back for a retry and counts a failure", async () => {
    const m = makeClient();
    const res = await executeDueFactorResets(m.client, async () => ({ ok: false as const, reason: "send_failed" as const }), ORIGIN);
    expect(res).toEqual({ claimed: 1, done: 0, failed: 1 });
    expect(m.calls.find(([n]) => n === "support_factor_reset_failed")![1]).toEqual({ p_reset_id: "r1", p_error: "mail_failed" });
    expect(names(m.calls)).not.toContain("support_factor_reset_done");
    expect(m.calls.find(([n]) => n === "record_support_factor_reset_run")![1]).toMatchObject({ p_done: 0, p_failed: 1 });
  });

  it("a factor that cannot be removed stops there: no invite is issued and no mail is sent", async () => {
    const m = makeClient({ deleteError: true });
    const send = vi.fn();
    const res = await executeDueFactorResets(m.client, send, ORIGIN);
    expect(res.failed).toBe(1);
    expect(names(m.calls)).not.toContain("issue_support_reset_invite");
    expect(send).not.toHaveBeenCalled();
  });

  it("a factor listing error, an invite error, a thrown mail error and a missing address are each failures, not successes", async () => {
    for (const opts of [{ listError: true }, { issueError: true }, { claim: [{ ...ROW, email: null }] }]) {
      const m = makeClient(opts);
      const res = await executeDueFactorResets(m.client, async () => ({ ok: true as const }), ORIGIN);
      expect(res.done).toBe(0);
      expect(res.failed).toBe(1);
    }
    const m = makeClient();
    const res = await executeDueFactorResets(m.client, async () => { throw new Error("smtp down"); }, ORIGIN);
    expect(res).toMatchObject({ done: 0, failed: 1 });
  });

  it("a done that the database did not accept is a failure and is not marked failed (it stays claimed)", async () => {
    const m = makeClient({ done: false });
    const res = await executeDueFactorResets(m.client, async () => ({ ok: true as const }), ORIGIN);
    expect(res).toEqual({ claimed: 1, done: 0, failed: 1 });
    expect(names(m.calls)).not.toContain("support_factor_reset_failed");
  });

  it("with no dashboard origin or a failed claim it claims nothing, writes a failure run and says so", async () => {
    const a = makeClient();
    expect(await executeDueFactorResets(a.client, vi.fn(), null)).toMatchObject({ claimed: 0, error: "not_configured" });
    expect(names(a.calls)).toEqual(["record_support_factor_reset_run"]);
    const b = makeClient({ claimError: true });
    expect(await executeDueFactorResets(b.client, vi.fn(), ORIGIN)).toMatchObject({ error: "claim_failed" });
    expect(b.calls.find(([n]) => n === "record_support_factor_reset_run")![1]).toMatchObject({ p_failed: 1 });
  });

  it("nothing due: no work, still a success run (a silent scheduler must show)", async () => {
    const m = makeClient({ claim: [] });
    expect(await executeDueFactorResets(m.client, vi.fn(), ORIGIN)).toEqual({ claimed: 0, done: 0, failed: 0 });
    expect(m.calls.find(([n]) => n === "record_support_factor_reset_run")![1]).toMatchObject({ p_done: 0, p_failed: 0 });
  });
});
