/** Story 22.8: recovery from the sign-in prompt (password session only). */
import { beforeEach, describe, expect, it, vi } from "vitest";

const rpcCalls: { fn: string; params: Record<string, unknown> }[] = [];
let rpcData: Record<string, unknown> = {};
let user: { id: string } | null = { id: "sa-1" };
const signOut = vi.fn(async () => ({ error: null }));
const send = vi.fn<(m: unknown) => Promise<{ ok: boolean; reason?: string }>>(async () => ({ ok: true }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ auth: { getUser: async () => ({ data: { user }, error: null }), signOut } })),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({
    rpc: vi.fn(async (fn: string, params: Record<string, unknown>) => {
      rpcCalls.push({ fn, params });
      return { data: rpcData[fn] ?? null, error: null };
    }),
  })),
}));
vi.mock("@/lib/mail", () => ({ sendMail: (m: unknown) => send(m) }));
vi.mock("@/lib/i18n/get-request-locale", () => ({ getRequestLocale: vi.fn(async () => "en") }));
vi.mock("@/lib/i18n/get-server-translation", () => ({ getServerTranslation: vi.fn(async () => ({ t: (k: string) => k })) }));

import { requestRecoveryCode, submitRecoveryCode } from "./recovery-actions";

const ok = { ok: true, reason: "ok", apply_at: "2026-10-16T12:30:00Z", login_email: "login@x.co", recovery_email: "rec@y.co" };

beforeEach(() => {
  rpcCalls.length = 0;
  rpcData = {};
  user = { id: "sa-1" };
  send.mockClear();
  send.mockResolvedValue({ ok: true });
  signOut.mockClear();
  vi.stubEnv("SUPER_ADMIN_APP_URL", "https://admin.example.com");
});

describe("requestRecoveryCode", () => {
  it("needs a session", async () => {
    user = null;
    expect((await requestRecoveryCode()).error?.code).toBe("no_session");
  });
  it("mails the stored address when the database allows it", async () => {
    rpcData.recovery_code_issue = [{ ok: true, reason: "ok", send_to: "rec@y.co" }];
    expect((await requestRecoveryCode()).data).toEqual({ requested: true });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ to: "rec@y.co" }));
    expect(rpcCalls[0].params).toMatchObject({ p_user: "sa-1", p_purpose: "recover", p_email: null });
  });
  it.each(["not_eligible", "no_recovery_email", "rate_limited", "locked", "already_pending"])(
    "answers exactly the same and sends nothing for %s (no enumeration)",
    async (reason) => {
      rpcData.recovery_code_issue = [{ ok: false, reason, send_to: null }];
      expect(await requestRecoveryCode()).toEqual({ data: { requested: true }, error: null });
      expect(send).not.toHaveBeenCalled();
    },
  );
});

describe("submitRecoveryCode", () => {
  it("refuses a malformed code before touching the database", async () => {
    expect((await submitRecoveryCode({ code: "abc" })).error?.code).toBe("invalid_code");
    expect(rpcCalls).toHaveLength(0);
  });

  it("refuses to start in production without a configured origin", async () => {
    vi.stubEnv("SUPER_ADMIN_APP_URL", "");
    vi.stubEnv("NODE_ENV", "production");
    expect((await submitRecoveryCode({ code: "123456" })).error?.code).toBe("not_configured");
    expect(rpcCalls).toHaveLength(0);
    vi.stubEnv("NODE_ENV", "test");
  });

  it("schedules, then tells both mailboxes with a cancel link carrying the same token", async () => {
    rpcData.recovery_request_verify = [ok];
    const res = await submitRecoveryCode({ code: "123456" });
    expect(res.data).toEqual({ applyAt: ok.apply_at });
    const token = String(rpcCalls[0].params.p_cancel_token);
    expect(token.length).toBeGreaterThanOrEqual(32);
    const tos = send.mock.calls.map((c) => (c[0] as { to: string }).to).sort();
    expect(tos).toEqual(["login@x.co", "rec@y.co"]);
    for (const c of send.mock.calls) expect((c[0] as { text: string }).text).toContain(`https://admin.example.com/auth/recovery/cancel?token=${token}`);
  });

  it("undoes the schedule when the login mailbox cannot be told", async () => {
    rpcData.recovery_request_verify = [ok];
    send.mockImplementation(async (m: unknown) => ((m as { to: string }).to === "login@x.co" ? { ok: false, reason: "send_failed" } : { ok: true }));
    const res = await submitRecoveryCode({ code: "123456" });
    expect(res.error?.code).toBe("mail_failed");
    const cancel = rpcCalls.find((c) => c.fn === "recovery_cancel");
    expect(cancel?.params.p_token).toBe(rpcCalls[0].params.p_cancel_token);
  });

  it("a wrong code mails nothing", async () => {
    rpcData.recovery_request_verify = [{ ok: false, reason: "invalid" }];
    expect((await submitRecoveryCode({ code: "123456" })).error?.code).toBe("invalid_code");
    expect(send).not.toHaveBeenCalled();
  });

  it("a lock signs the session out and says so", async () => {
    rpcData.recovery_request_verify = [{ ok: false, reason: "locked" }];
    const res = await submitRecoveryCode({ code: "123456" });
    expect(res.error).toMatchObject({ code: "account_locked", locked: true });
    expect(signOut).toHaveBeenCalled();
  });
});
