import { beforeEach, describe, expect, it, vi } from "vitest";

let allowed = true;
const rpc = vi.fn();
const createUser = vi.fn();
const adminRpc = vi.fn();
const deleteUser = vi.fn();
const getUserById = vi.fn();
const sendMail = vi.fn();

vi.mock("@/lib/authz-action", () => ({
  authorizeOrRedirect: vi.fn(async () =>
    allowed ? { ok: true, actorId: "sa-1" } : { ok: false, error: { code: "permission_denied", message: "denied" }, reason: "x" },
  ),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => ({ rpc: (...a: unknown[]) => rpc(...a) })) }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc: (...a: unknown[]) => adminRpc(...a), auth: { admin: { createUser, deleteUser, getUserById } } }),
}));
vi.mock("@/services/gyms", () => ({ mapAndLog: vi.fn(async () => ({ code: "unknown", message: "m" })) }));
vi.mock("@/lib/mail", () => ({ sendMail: (...a: unknown[]) => sendMail(...a) }));
vi.mock("@/lib/i18n/get-request-locale", () => ({ getRequestLocale: vi.fn(async () => "en") }));
vi.mock("@/lib/i18n/get-server-translation", () => ({ getServerTranslation: vi.fn(async () => ({ t: (k: string) => k })) }));

const UID = "00000000-0000-4000-8000-0000000000aa";

beforeEach(() => {
  allowed = true;
  rpc.mockReset();
  adminRpc.mockReset();
  createUser.mockReset();
  deleteUser.mockReset();
  getUserById.mockReset();
  sendMail.mockReset();
  process.env.DASHBOARD_APP_URL = "https://owner.gymosapps.com";
});

describe("createSupportAccount", () => {
  it("refuses a denied caller before any work", async () => {
    allowed = false;
    const { createSupportAccount } = await import("./actions");
    const res = await createSupportAccount({ displayName: "A", email: "a@gymosapps.com" });
    expect(res.error?.code).toBe("permission_denied");
    expect(createUser).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects a non-gymosapps.com address before creating anything", async () => {
    const { createSupportAccount } = await import("./actions");
    const res = await createSupportAccount({ displayName: "A", email: "a@x.example" });
    expect(res.error?.code).toBe("validation_error");
    expect(createUser).not.toHaveBeenCalled();
  });

  it("creates a password-less confirmed auth user, then the account", async () => {
    createUser.mockResolvedValue({ data: { user: { id: UID } }, error: null });
    rpc.mockResolvedValue({ data: UID, error: null });
    const { createSupportAccount } = await import("./actions");
    const res = await createSupportAccount({ displayName: " Sup ", email: "Sup@GymOSApps.com" });
    expect(res).toEqual({ data: { userId: UID }, error: null });
    expect(createUser).toHaveBeenCalledWith({ email: "sup@gymosapps.com", email_confirm: true });
    expect(rpc).toHaveBeenCalledWith("create_support_account", { p_user_id: UID, p_display_name: "Sup", p_email: "sup@gymosapps.com" });
  });

  it("answers an existing address and a database refusal with the same message, and removes the new auth user", async () => {
    const { createSupportAccount } = await import("./actions");
    createUser.mockResolvedValueOnce({ data: { user: null }, error: { message: "exists" } });
    const a = await createSupportAccount({ displayName: "A", email: "a@gymosapps.com" });
    createUser.mockResolvedValueOnce({ data: { user: { id: UID } }, error: null });
    rpc.mockResolvedValueOnce({ data: null, error: { message: "support_account_refused" } });
    const b = await createSupportAccount({ displayName: "A", email: "a@gymosapps.com" });
    expect(a.error?.message).toBe("support.errors.refused");
    expect(b.error?.message).toBe(a.error?.message);
    expect(deleteUser).toHaveBeenCalledWith(UID);
  });
});

describe("sendSupportInvite", () => {
  it("issues a hashed-side token and mails the link; the link never comes back to the browser", async () => {
    getUserById.mockResolvedValue({ data: { user: { email: "sup@gymosapps.com" } }, error: null });
    adminRpc.mockResolvedValue({ data: "2026-10-22T00:00:00Z", error: null });
    sendMail.mockResolvedValue({ ok: true });
    const { sendSupportInvite } = await import("./actions");
    const res = await sendSupportInvite(UID);
    expect(res).toEqual({ data: { sent: true }, error: null });
    const [name, args] = adminRpc.mock.calls[0] as [string, { p_user_id: string; p_token: string; p_actor: string }];
    expect(name).toBe("issue_support_invite");
    expect(args).toMatchObject({ p_user_id: UID, p_actor: "sa-1" });
    expect(rpc).not.toHaveBeenCalled();
    const mail = sendMail.mock.calls[0][0] as { to: string; text: string };
    expect(mail.to).toBe("sup@gymosapps.com");
    expect(mail.text).toContain(`https://owner.gymosapps.com/support-invite?t=${encodeURIComponent(args.p_token)}`);
    expect(JSON.stringify(res)).not.toContain(args.p_token);
  });

  it("builds no link and issues nothing without a configured dashboard origin", async () => {
    delete process.env.DASHBOARD_APP_URL;
    const { sendSupportInvite } = await import("./actions");
    const res = await sendSupportInvite(UID);
    expect(res.error?.code).toBe("not_configured");
    expect(adminRpc).not.toHaveBeenCalled();
  });

  it("refuses an account whose address is not @gymosapps.com", async () => {
    getUserById.mockResolvedValue({ data: { user: { email: "x@x.example" } }, error: null });
    const { sendSupportInvite } = await import("./actions");
    const res = await sendSupportInvite(UID);
    expect(res.error?.code).toBe("support_invite_refused");
    expect(adminRpc).not.toHaveBeenCalled();
  });

  it("reports a failed send without exposing the link", async () => {
    getUserById.mockResolvedValue({ data: { user: { email: "sup@gymosapps.com" } }, error: null });
    adminRpc.mockResolvedValue({ data: "x", error: null });
    sendMail.mockResolvedValue({ ok: false, reason: "send_failed" });
    const { sendSupportInvite } = await import("./actions");
    const res = await sendSupportInvite(UID);
    expect(res.error?.code).toBe("mail_failed");
  });
});
