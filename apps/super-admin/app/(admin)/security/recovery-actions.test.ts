/** Story 22.8: /security recovery email actions. */
import { beforeEach, describe, expect, it, vi } from "vitest";

const rpcCalls: { fn: string; params: Record<string, unknown> }[] = [];
let rpcData: Record<string, unknown> = {};
let authz: { ok: boolean } = { ok: true };
let stepUpOk = true;
const consume = vi.fn(async () => stepUpOk);
const send = vi.fn<(m: unknown) => Promise<{ ok: boolean; reason?: string }>>(async () => ({ ok: true }));

vi.mock("@/lib/authz", () => ({
  authorizePlatformAction: vi.fn(async () => (authz.ok ? { ok: true, actorId: "sa-1" } : { ok: false, error: { code: "permission_denied", message: "no" }, reason: "x" })),
  consumeStepUp: (...a: unknown[]) => (consume as unknown as (...x: unknown[]) => Promise<boolean>)(...a),
  STEP_UP_REQUIRED_CODE: "step_up_required",
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({
    rpc: vi.fn(async (fn: string, params: Record<string, unknown>) => {
      rpcCalls.push({ fn, params });
      return { data: rpcData[fn] ?? null, error: null };
    }),
  })),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ auth: { getUser: async () => ({ data: { user: { id: "sa-1", email: "login@x.co" } }, error: null }) } })),
}));
vi.mock("@/lib/mail", () => ({ sendMail: (m: unknown) => send(m) }));
vi.mock("@/lib/i18n/get-request-locale", () => ({ getRequestLocale: vi.fn(async () => "en") }));
vi.mock("@/lib/i18n/get-server-translation", () => ({ getServerTranslation: vi.fn(async () => ({ t: (k: string) => k })) }));

import { removeRecoveryEmail, requestRecoveryEmailCode, verifyRecoveryEmail } from "./recovery-actions";

beforeEach(() => {
  rpcCalls.length = 0;
  rpcData = { recovery_status: [{ has_email: false, masked: null, pending_apply_at: null }] };
  authz = { ok: true };
  stepUpOk = true;
  consume.mockClear();
  send.mockClear();
  send.mockResolvedValue({ ok: true });
});

describe("requestRecoveryEmailCode", () => {
  it("is denied without a live Super Admin", async () => {
    authz = { ok: false };
    expect((await requestRecoveryEmailCode({ email: "r@x.co" })).error?.code).toBe("permission_denied");
    expect(rpcCalls).toHaveLength(0);
  });

  it("setting the first address needs no step-up and mails the stored send_to, never raw input", async () => {
    rpcData.recovery_code_issue = [{ ok: true, reason: "ok", send_to: "r@x.co" }];
    const res = await requestRecoveryEmailCode({ email: " R@X.co " });
    expect(res.error).toBeNull();
    expect(consume).not.toHaveBeenCalled();
    const issue = rpcCalls.find((c) => c.fn === "recovery_code_issue")!;
    expect(issue.params).toMatchObject({ p_user: "sa-1", p_purpose: "register", p_email: " R@X.co " });
    expect(String(issue.params.p_code)).toMatch(/^\d{6}$/);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ to: "r@x.co" }));
    expect(JSON.stringify(send.mock.calls)).toContain(String(issue.params.p_code));
  });

  it("fails closed when the recovery status cannot be read: no step-up skip, no code, no mail", async () => {
    rpcData.recovery_status = null as unknown as Record<string, unknown>;
    const res = await requestRecoveryEmailCode({ email: "n@x.co" });
    expect(res.error?.code).toBe("recovery_failed");
    expect(rpcCalls.some((c) => c.fn === "recovery_code_issue")).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it("changing an existing address needs a step-up before any code is issued", async () => {
    rpcData.recovery_status = [{ has_email: true, masked: "r***@x.co", pending_apply_at: null }];
    stepUpOk = false;
    const res = await requestRecoveryEmailCode({ email: "n@x.co" });
    expect(res.error?.code).toBe("step_up_required");
    expect(rpcCalls.some((c) => c.fn === "recovery_code_issue")).toBe(false);
    expect(send).not.toHaveBeenCalled();
    expect(consume).toHaveBeenCalledWith("sa-1", "change_recovery_email", "recovery");
  });

  it.each([
    ["same_as_login", "security.recovery.errors.sameAsLogin"],
    ["invalid_email", "security.recovery.errors.invalidEmail"],
    ["rate_limited", "security.recovery.errors.rateLimited"],
    ["not_eligible", "security.recovery.errors.generic"],
  ])("maps the refusal %s and sends nothing", async (reason, message) => {
    rpcData.recovery_code_issue = [{ ok: false, reason, send_to: null }];
    const res = await requestRecoveryEmailCode({ email: "r@x.co" });
    expect(res.error?.message).toBe(message);
    expect(send).not.toHaveBeenCalled();
  });

  it("says when mail is not configured", async () => {
    rpcData.recovery_code_issue = [{ ok: true, reason: "ok", send_to: "r@x.co" }];
    send.mockResolvedValue({ ok: false, reason: "not_configured" });
    expect((await requestRecoveryEmailCode({ email: "r@x.co" })).error?.message).toBe("security.recovery.errors.notConfigured");
  });

  it("voids the code and gives the attempt back when the mail cannot be sent", async () => {
    rpcData.recovery_code_issue = [{ ok: true, reason: "ok", send_to: "r@x.co" }];
    send.mockResolvedValue({ ok: false, reason: "send_failed" });
    const res = await requestRecoveryEmailCode({ email: "r@x.co" });
    expect(res.error?.code).toBe("mail_failed");
    expect(rpcCalls.find((c) => c.fn === "recovery_code_mail_failed")?.params).toEqual({ p_user: "sa-1", p_purpose: "register" });
  });

  it("does not report a failed send when the mail went out", async () => {
    rpcData.recovery_code_issue = [{ ok: true, reason: "ok", send_to: "r@x.co" }];
    await requestRecoveryEmailCode({ email: "r@x.co" });
    expect(rpcCalls.some((c) => c.fn === "recovery_code_mail_failed")).toBe(false);
  });
});

describe("verifyRecoveryEmail", () => {
  it("rejects a malformed code without calling the database", async () => {
    expect((await verifyRecoveryEmail({ code: "12ab" })).error?.code).toBe("invalid_code");
    expect(rpcCalls).toHaveLength(0);
  });
  it("returns only the masked address", async () => {
    rpcData.recovery_register_verify = [{ ok: true, reason: "ok", masked: "r***@x.co" }];
    expect((await verifyRecoveryEmail({ code: "123 456" })).data).toEqual({ masked: "r***@x.co" });
    expect(rpcCalls.find((c) => c.fn === "recovery_register_verify")!.params).toMatchObject({ p_code: "123456" });
  });
  it("tells the login mailbox, with only the masked address", async () => {
    rpcData.recovery_register_verify = [{ ok: true, reason: "ok", masked: "r***@x.co" }];
    await verifyRecoveryEmail({ code: "123456" });
    expect(send).toHaveBeenCalledTimes(1);
    const mail = send.mock.calls[0][0] as { to: string; text: string };
    expect(mail.to).toBe("login@x.co");
    expect(mail.text).toContain("r***@x.co");
  });
  it("sends no notice for a wrong code", async () => {
    rpcData.recovery_register_verify = [{ ok: false, reason: "invalid", masked: null }];
    await verifyRecoveryEmail({ code: "123456" });
    expect(send).not.toHaveBeenCalled();
  });
  it("reports a lock distinctly and a wrong code generically", async () => {
    rpcData.recovery_register_verify = [{ ok: false, reason: "locked", masked: null }];
    expect((await verifyRecoveryEmail({ code: "123456" })).error?.code).toBe("account_locked");
    rpcData.recovery_register_verify = [{ ok: false, reason: "invalid", masked: null }];
    expect((await verifyRecoveryEmail({ code: "123456" })).error?.code).toBe("invalid_code");
  });
});

describe("removeRecoveryEmail", () => {
  it("needs a step-up", async () => {
    stepUpOk = false;
    expect((await removeRecoveryEmail()).error?.code).toBe("step_up_required");
    expect(rpcCalls.some((c) => c.fn === "recovery_email_remove")).toBe(false);
  });
  it("removes after a step-up", async () => {
    rpcData.recovery_email_remove = true as unknown as Record<string, unknown>;
    expect((await removeRecoveryEmail()).data).toEqual({ removed: true });
    expect(consume).toHaveBeenCalledWith("sa-1", "remove_recovery_email", "recovery");
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ to: "login@x.co" }));
  });
  it("sends no notice when nothing was removed", async () => {
    rpcData.recovery_email_remove = false as unknown as Record<string, unknown>;
    expect((await removeRecoveryEmail()).data).toEqual({ removed: false });
    expect(send).not.toHaveBeenCalled();
  });
});
