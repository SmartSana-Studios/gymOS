/** Owner decisions 2026-10-17: new/promoted Super Admins are emailed; a gym owner can never be promoted. */
import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
const sendMail = vi.fn<(m: { to: string; subject: string; text: string }) => Promise<{ ok: boolean }>>(async () => ({ ok: true }));
let existingUser: { id: string } | null = null;
let ownerRows: { id: string }[] = [];
const createAuthUser = vi.fn();

const adminClient = {
  rpc: vi.fn(async () => ({ data: false, error: null })), // super_admin_aal2_required -> off
  from: () => {
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq", "is"]) chain[m] = () => chain;
    chain.limit = async () => ({ data: ownerRows, error: null });
    return chain;
  },
};

vi.mock("@/lib/authz", () => ({
  STEP_UP_REQUIRED_CODE: "step_up_required",
  consumeStepUp: vi.fn(async () => true),
  authorizePlatformAction: vi.fn(async () => ({ ok: true, actorId: "sa-1" })),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: async () => ({ data: { user: { email: "sa@example.com" } }, error: null }),
      signInWithPassword: async () => ({ error: null }),
    },
    rpc: (...a: unknown[]) => rpc(...a),
  })),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => adminClient }));
vi.mock("@/services/gyms", () => ({ mapAndLog: vi.fn(async () => ({ code: "unknown", message: "m" })) }));
vi.mock("@/lib/mail", () => ({ sendMail: (m: { to: string; subject: string; text: string }) => sendMail(m) }));
vi.mock("@/lib/i18n/get-request-locale", () => ({ getRequestLocale: vi.fn(async () => "en") }));
vi.mock("@/lib/i18n/get-server-translation", () => ({ getServerTranslation: vi.fn(async () => ({ t: (k: string) => k })) }));
vi.mock("@/lib/super-admin-provisioning.mjs", () => ({
  createAuthUserWithTempPassword: (...a: unknown[]) => createAuthUser(...a),
  deleteAuthUserAndLog: vi.fn(),
  displayNameFromEmail: vi.fn(() => "x"),
  findUserByEmail: vi.fn(async () => existingUser),
}));

import { createOrPromoteSuperAdmin } from "./actions";

const input = { email: "New.Admin@Example.com ", currentPassword: "pw-123456" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("SUPER_ADMIN_APP_URL", "https://admin.example.com");
  existingUser = null;
  ownerRows = [];
  sendMail.mockResolvedValue({ ok: true });
  createAuthUser.mockResolvedValue({ userId: "u-new", tempPassword: "Tmp-Pass-123" });
  rpc.mockImplementation(async (fn: string) =>
    fn === "promote_to_super_admin" ? { data: [{ already_super_admin: false, display_name_set: true }], error: null } : { data: "audit", error: null },
  );
});

describe("createOrPromoteSuperAdmin invitations", () => {
  it("emails a newly created admin their sign-in details and the temp password", async () => {
    const res = await createOrPromoteSuperAdmin(input);
    expect(res.data).toMatchObject({ outcome: "created", tempPassword: "Tmp-Pass-123", emailed: true });
    expect(sendMail).toHaveBeenCalledTimes(1);
    const mail = sendMail.mock.calls[0][0];
    expect(mail.to).toBe("New.Admin@Example.com");
    expect(mail.text).toContain("Tmp-Pass-123");
    expect(mail.text).toContain("https://admin.example.com/auth/login");
  });

  it("a failed email never undoes the account: emailed=false, the temp password is still returned", async () => {
    sendMail.mockResolvedValue({ ok: false });
    const res = await createOrPromoteSuperAdmin(input);
    expect(res.data).toMatchObject({ outcome: "created", tempPassword: "Tmp-Pass-123", emailed: false });
  });

  it("a transport that throws is also best effort", async () => {
    sendMail.mockRejectedValue(new Error("smtp down"));
    const res = await createOrPromoteSuperAdmin(input);
    expect(res.data?.outcome).toBe("created");
    expect(res.data?.emailed).toBe(false);
  });

  it("emails a promoted account a notice with no password", async () => {
    existingUser = { id: "u-existing" };
    const res = await createOrPromoteSuperAdmin(input);
    expect(res.data).toMatchObject({ outcome: "promoted", tempPassword: null, emailed: true });
    expect(sendMail.mock.calls[0][0].text).not.toMatch(/password:/i);
  });

  it("sends nothing when the account was already a Super Admin", async () => {
    existingUser = { id: "u-existing" };
    rpc.mockResolvedValueOnce({ data: [{ already_super_admin: true, display_name_set: false }], error: null });
    const res = await createOrPromoteSuperAdmin(input);
    expect(res.data).toMatchObject({ outcome: "already_super_admin", emailed: false });
    expect(sendMail).not.toHaveBeenCalled();
  });
});

describe("a gym owner can never be a Super Admin", () => {
  it("refuses to promote an active gym owner, before any write or email", async () => {
    existingUser = { id: "u-owner" };
    ownerRows = [{ id: "m-1" }];
    const res = await createOrPromoteSuperAdmin(input);
    expect(res.error?.code).toBe("owner_cannot_be_super_admin");
    expect(rpc).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("maps the database guard (migration 0130) if the pre-check is bypassed", async () => {
    existingUser = { id: "u-owner" };
    rpc.mockResolvedValueOnce({ data: null, error: { message: "owner_is_super_admin: a gym owner cannot be a Super Admin" } });
    const res = await createOrPromoteSuperAdmin(input);
    expect(res.error?.code).toBe("owner_cannot_be_super_admin");
    expect(sendMail).not.toHaveBeenCalled();
  });
});
