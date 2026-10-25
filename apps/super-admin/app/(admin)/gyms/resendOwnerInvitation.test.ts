/**
 * resendOwnerInvitation: a new temporary password for the gym's owner account, the forced password change re-armed,
 * the welcome message sent again (link only on the free-text channel), the audit entry written without the password.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

let authzAllowed = true;
vi.mock("@/lib/authz", () => ({
  authorizePlatformAction: vi.fn(async () =>
    authzAllowed
      ? { ok: true, actorId: "sa-1" }
      : { ok: false, error: { code: "permission_denied", message: "errors.permissionDenied" } },
  ),
}));

type OwnerRow = { user_id: string; name: string; phone: string | null; gyms: { name: string; status: string } } | null;
let ownerRow: OwnerRow;
let updateUserResult: { error: unknown };
let flagResult: { error: unknown };
const updateUserByIdMock = vi.fn(async (..._args: unknown[]) => updateUserResult);
const usersUpdateMock = vi.fn((_values: Record<string, unknown>) => ({ eq: async () => flagResult }));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    auth: { admin: { updateUserById: updateUserByIdMock } },
    from: (table: string) =>
      table === "members"
        ? {
            select: () => {
              const node: Record<string, unknown> = {};
              for (const m of ["eq", "is", "order", "limit"]) node[m] = () => node;
              node.maybeSingle = async () => ({ data: ownerRow, error: null });
              return node;
            },
          }
        : { update: usersUpdateMock },
  }),
}));

const deliverMock = vi.fn(async (..._args: unknown[]): Promise<{ result: { success: boolean }; linkSent: boolean }> => ({
  result: { success: true },
  linkSent: true,
}));
vi.mock("@/lib/messaging/ownerWelcome", () => ({ deliverOwnerWelcome: (...a: unknown[]) => deliverMock(...a) }));

const auditMock = vi.fn(async (..._args: unknown[]) => ({ error: null as unknown }));
vi.mock("@/services/gyms", () => ({
  gymNameExists: async () => false,
  gymNameTakenByOther: async () => false,
  insertGym: async () => ({ data: null, error: null }),
  setGymCategory: async () => ({ error: null }),
  insertOwnerMember: async () => ({ error: null }),
  deleteGym: async () => {},
  logGymCreated: async () => {},
  mapAndLog: async (e: unknown) => ({ code: "mapped", message: String(e) }),
  logGymDataEscalation: async () => {},
  logGymLifecycleEvent: (...a: unknown[]) => auditMock(...a),
  revokeGymDataAccess: async () => ({ error: null }),
  updateGymCapOverride: async () => ({ error: null }),
  updateGymName: async () => ({ data: null, error: null }),
  rpcChangeOwnerContact: async () => ({ data: null, error: null }),
  updateGymStatus: async () => ({ error: null }),
  updateGymTier: async () => ({ error: null }),
}));
vi.mock("@/lib/super-admin-provisioning.mjs", () => ({ findUserByEmail: async () => null }));
vi.mock("@/lib/i18n/get-request-locale", () => ({ getRequestLocale: async () => "en" }));
vi.mock("@/lib/i18n/get-server-translation", () => ({
  getServerTranslation: async () => ({
    t: (key: string, vars?: Record<string, string>) => (vars ? key + ":" + Object.values(vars).join(",") : key),
  }),
}));
vi.mock("@/lib/temp-password.mjs", () => ({ generateTempPassword: () => "NewTemp456" }));

const { resendOwnerInvitation } = await import("./actions");

const GYM = "00000000-0000-4000-8000-0000000000aa";
const OWNER: NonNullable<OwnerRow> = {
  user_id: "owner-1",
  name: "Tamufor",
  phone: "+237674783177",
  gyms: { name: "Martin's Fitness Center", status: "active" },
};

beforeEach(() => {
  vi.clearAllMocks();
  authzAllowed = true;
  ownerRow = OWNER;
  updateUserResult = { error: null };
  flagResult = { error: null };
  process.env.DASHBOARD_APP_URL = "https://owner.example.test";
});

describe("resendOwnerInvitation", () => {
  it("sets a new password, re-arms the forced change, resends the welcome message and audits without the password", async () => {
    const { data, error } = await resendOwnerInvitation(GYM, { reason: "Owner lost the first message" });
    expect(error).toBeNull();
    expect(updateUserByIdMock).toHaveBeenCalledWith("owner-1", { password: "NewTemp456" });
    expect(usersUpdateMock).toHaveBeenCalledWith({ must_change_password: true });
    expect(deliverMock).toHaveBeenCalledTimes(1);
    const args = deliverMock.mock.calls[0][0] as { phone: string; tempPassword: string; welcomeMessage: string };
    expect(args.phone).toBe("+237674783177");
    expect(args.tempPassword).toBe("NewTemp456");
    expect(args.welcomeMessage).toContain("https://owner.example.test/auth/login");
    expect(data).toMatchObject({ tempPassword: "NewTemp456", smsSent: true, linkSent: true, loginUrl: "https://owner.example.test/auth/login" });

    expect(auditMock).toHaveBeenCalledWith("gym_owner_invitation_resent", GYM, {
      reason: "Owner lost the first message",
      delivered: true,
      link_sent: true,
    });
    expect(JSON.stringify(auditMock.mock.calls)).not.toContain("NewTemp456");
  });

  it("reports an undelivered message but still returns the new password so the admin can pass it on", async () => {
    deliverMock.mockResolvedValueOnce({ result: { success: false }, linkSent: false });
    const { data } = await resendOwnerInvitation(GYM, { reason: "Owner lost the first message" });
    expect(data).toMatchObject({ tempPassword: "NewTemp456", smsSent: false, linkSent: false });
    expect(data?.welcomeMessage).toBeTruthy();
  });

  it("changes nothing when the password update fails", async () => {
    updateUserResult = { error: new Error("auth down") };
    const { data, error } = await resendOwnerInvitation(GYM, { reason: "Owner lost the first message" });
    expect(data).toBeNull();
    expect(error?.code).toBe("password_update_failed");
    expect(deliverMock).not.toHaveBeenCalled();
    expect(auditMock).not.toHaveBeenCalled();
  });

  it("still returns the new password when re-arming the forced change fails", async () => {
    flagResult = { error: new Error("db") };
    const { data } = await resendOwnerInvitation(GYM, { reason: "Owner lost the first message" });
    expect(data?.tempPassword).toBe("NewTemp456");
  });

  it("refuses a gym with no active owner phone, and a deactivated gym, touching nothing", async () => {
    ownerRow = null;
    expect((await resendOwnerInvitation(GYM, { reason: "Owner lost the first message" })).error?.code).toBe("owner_not_found");
    ownerRow = { ...OWNER, phone: null };
    expect((await resendOwnerInvitation(GYM, { reason: "Owner lost the first message" })).error?.code).toBe("owner_not_found");
    ownerRow = { ...OWNER, gyms: { name: "x", status: "deactivated" } };
    expect((await resendOwnerInvitation(GYM, { reason: "Owner lost the first message" })).error?.code).toBe("gym_deactivated");
    expect(updateUserByIdMock).not.toHaveBeenCalled();
  });

  it("requires a reason and a valid gym id before reading anything", async () => {
    expect((await resendOwnerInvitation(GYM, { reason: "x" })).error?.code).toBe("validation_error");
    expect((await resendOwnerInvitation("not-a-uuid", { reason: "Owner lost the first message" })).error?.code).toBe("validation_error");
    expect(updateUserByIdMock).not.toHaveBeenCalled();
  });

  it("a caller who is no longer a Super Admin changes nothing", async () => {
    authzAllowed = false;
    const { data, error } = await resendOwnerInvitation(GYM, { reason: "Owner lost the first message" }).catch(() => ({ data: null, error: { code: "redirected" } }));
    expect(data).toBeNull();
    expect(error).not.toBeNull();
    expect(updateUserByIdMock).not.toHaveBeenCalled();
  });
});
