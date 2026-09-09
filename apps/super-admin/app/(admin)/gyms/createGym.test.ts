/**
 * Story 1.17 (code review, Task 7): unit tests for `createGym`'s owner
 * resolution — the created-vs-linked branch, the Super Admin refusal, the
 * confirmation gate, the phone-collision guard, and above all the
 * `ownerOutcome === "created"` gate on `deleteAuthUserAndLog`.
 *
 * That gate is the reason this file exists. Story 1.17 named it "the single
 * most destructive mistake available in this story": on the linked path the
 * owner account pre-existed and may own other gyms, and `public.users.id`
 * cascades from `auth.users`, so an ungated cleanup would delete a real
 * owner's login *and* their profile row. It had no coverage at all until this
 * review.
 *
 * Dependency-mock shape mirrors apps/dashboard/services/staff.createStaffMember.test.ts
 * (this codebase's established precedent for exactly this admin-client +
 * compensating-cleanup pattern) rather than inventing a new one.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

let findUserByEmailResult: { id: string; last_sign_in_at: string | null } | null;
let profileResult: { data: { is_super_admin: boolean; display_name: string | null } | null; error: unknown };
let phoneOwnerResult: { data: { id: string } | null; error: unknown };
let createUserResult: { data: { user: { id: string } } | null; error: unknown };
let insertGymResult: { data: { id: string } | null; error: unknown };
let insertOwnerMemberResult: { error: unknown };

const createUserMock = vi.fn(async () => createUserResult);
const deleteGymMock = vi.fn(async () => {});
const deleteUserMock = vi.fn(async () => ({ error: null }));
const sendTempPasswordMessageMock = vi.fn(async () => ({ success: true as const }));
const logGymCreatedMock = vi.fn(async () => {});
const insertOwnerMemberMock = vi.fn(async () => insertOwnerMemberResult);

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    auth: { admin: { createUser: createUserMock, deleteUser: deleteUserMock } },
    from: (table: string) => ({
      select: () => ({
        eq: (col: string) => ({
          maybeSingle: async () => (table === "users" && col === "phone" ? phoneOwnerResult : profileResult),
        }),
      }),
    }),
  }),
}));

vi.mock("@/lib/super-admin-provisioning.mjs", () => ({
  findUserByEmail: async () => findUserByEmailResult,
}));

vi.mock("@/services/gyms", () => ({
  gymNameExists: async () => false,
  insertGym: async () => insertGymResult,
  insertOwnerMember: () => insertOwnerMemberMock(),
  deleteGym: (id: string) => deleteGymMock(id),
  logGymCreated: (...args: unknown[]) => logGymCreatedMock(...(args as [])),
  mapAndLog: async (e: unknown) => ({ code: "mapped", message: String(e) }),
  logGymDataEscalation: async () => {},
  logGymLifecycleEvent: async () => {},
  revokeGymDataAccess: async () => ({ error: null }),
  updateGymCapOverride: async () => ({ error: null }),
  updateGymStatus: async () => ({ error: null }),
  updateGymTier: async () => ({ error: null }),
}));

vi.mock("@/lib/messaging/sendTempPasswordMessage", () => ({
  sendTempPasswordMessage: () => sendTempPasswordMessageMock(),
}));

vi.mock("@/lib/i18n/get-request-locale", () => ({ getRequestLocale: async () => "en" }));
vi.mock("@/lib/i18n/get-server-translation", () => ({
  getServerTranslation: async () => ({ t: (key: string) => key }),
}));
vi.mock("@/lib/temp-password.mjs", () => ({ generateTempPassword: () => "TempPass123" }));

const { createGym } = await import("./actions");

const VALID = {
  gymName: "Branch Two",
  ownerName: "Paul Nkusu",
  ownerPhone: "+237600000001",
  ownerEmail: "paul@example.com",
  tierId: "00000000-0000-4000-8000-000000000101",
  status: "active" as const,
};

beforeEach(() => {
  vi.clearAllMocks();
  findUserByEmailResult = null;
  profileResult = { data: { is_super_admin: false, display_name: "Paul Nkusu" }, error: null };
  phoneOwnerResult = { data: null, error: null };
  createUserResult = { data: { user: { id: "new-user" } }, error: null };
  insertGymResult = { data: { id: "gym-1" }, error: null };
  insertOwnerMemberResult = { error: null };
});

describe("createGym — owner resolution", () => {
  it("creates a new account when the email is unknown", async () => {
    const { data, error } = await createGym(VALID);
    expect(error).toBeNull();
    expect(data?.ownerOutcome).toBe("created");
    expect(data?.tempPassword).toBe("TempPass123");
    expect(createUserMock).toHaveBeenCalledTimes(1);
    expect(sendTempPasswordMessageMock).toHaveBeenCalledTimes(1);
  });

  it("links an existing account without creating one or sending a password", async () => {
    findUserByEmailResult = { id: "existing-user", last_sign_in_at: "2026-01-01T00:00:00Z" };
    const { data, error } = await createGym({ ...VALID, confirmLinkExistingOwner: true });
    expect(error).toBeNull();
    expect(data?.ownerOutcome).toBe("linked");
    expect(data?.tempPassword).toBeNull();
    expect(data?.ownerNeverSignedIn).toBe(false);
    expect(createUserMock).not.toHaveBeenCalled();
    expect(sendTempPasswordMessageMock).not.toHaveBeenCalled();
  });

  it("reports an existing account that has never signed in", async () => {
    findUserByEmailResult = { id: "existing-user", last_sign_in_at: null };
    const { data } = await createGym({ ...VALID, confirmLinkExistingOwner: true });
    expect(data?.ownerNeverSignedIn).toBe(true);
  });

  it("refuses to link without explicit confirmation, writing nothing", async () => {
    findUserByEmailResult = { id: "existing-user", last_sign_in_at: null };
    const { data, error } = await createGym(VALID);
    expect(data).toBeNull();
    expect(error?.code).toBe("owner_link_requires_confirmation");
    expect(insertGymResult.data).toEqual({ id: "gym-1" }); // stub untouched
    expect(insertOwnerMemberMock).not.toHaveBeenCalled();
    expect(deleteGymMock).not.toHaveBeenCalled(); // nothing was written, so nothing to clean up
  });

  it("refuses a Super Admin account, writing nothing", async () => {
    findUserByEmailResult = { id: "super-user", last_sign_in_at: null };
    profileResult = { data: { is_super_admin: true, display_name: "Platform Staff" }, error: null };
    const { data, error } = await createGym({ ...VALID, confirmLinkExistingOwner: true });
    expect(data).toBeNull();
    expect(error?.code).toBe("owner_is_super_admin");
    expect(insertOwnerMemberMock).not.toHaveBeenCalled();
    expect(deleteGymMock).not.toHaveBeenCalled();
  });

  it("refuses when the phone belongs to another account, writing nothing", async () => {
    phoneOwnerResult = { data: { id: "member-user" }, error: null };
    const { data, error } = await createGym(VALID);
    expect(data).toBeNull();
    expect(error?.code).toBe("owner_phone_belongs_to_other_account");
    expect(createUserMock).not.toHaveBeenCalled();
    expect(deleteGymMock).not.toHaveBeenCalled();
  });
});

describe("createGym — compensating cleanup", () => {
  it("deletes the auth user it created when the membership insert fails", async () => {
    insertOwnerMemberResult = { error: { code: "boom", message: "boom" } };
    const { error } = await createGym(VALID);
    expect(error).not.toBeNull();
    expect(deleteGymMock).toHaveBeenCalledWith("gym-1");
    expect(deleteUserMock).toHaveBeenCalledTimes(1);
  });

  it("NEVER deletes a pre-existing linked account when the membership insert fails", async () => {
    // The regression this whole file exists for: deleting here would destroy
    // a real owner's login and cascade away their public.users row.
    findUserByEmailResult = { id: "existing-user", last_sign_in_at: "2026-01-01T00:00:00Z" };
    insertOwnerMemberResult = { error: { code: "boom", message: "boom" } };
    const { error } = await createGym({ ...VALID, confirmLinkExistingOwner: true });
    expect(error).not.toBeNull();
    expect(deleteGymMock).toHaveBeenCalledWith("gym-1");
    expect(deleteUserMock).not.toHaveBeenCalled();
  });
});

describe("createGym — audit metadata", () => {
  it("records sms_sent null on the linked path, not false", async () => {
    findUserByEmailResult = { id: "existing-user", last_sign_in_at: "2026-01-01T00:00:00Z" };
    await createGym({ ...VALID, confirmLinkExistingOwner: true });
    const meta = logGymCreatedMock.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(meta.owner_outcome).toBe("linked");
    expect(meta.sms_sent).toBeNull();
  });
});
