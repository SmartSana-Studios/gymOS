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
let membershipResult: { data: { name: string } | null; error: unknown };
let findUserByEmailQueue: (typeof findUserByEmailResult)[];
let createUserResult: { data: { user: { id: string } } | null; error: unknown };
let insertGymResult: { data: { id: string } | null; error: unknown };
let insertOwnerMemberResult: { error: unknown };

const createUserMock = vi.fn(async () => createUserResult);
const deleteGymMock = vi.fn<(id: string) => Promise<void>>(async () => {});
const deleteUserMock = vi.fn(async () => ({ error: null }));
const sendTempPasswordMessageMock = vi.fn(async () => ({ success: true as const }));
const logGymCreatedMock = vi.fn<(id: string, meta: Record<string, unknown>) => Promise<void>>(async () => {});
const insertGymMock = vi.fn<() => Promise<typeof insertGymResult>>(async () => insertGymResult);
const insertOwnerMemberMock = vi.fn<(input: { userId: string }) => Promise<typeof insertOwnerMemberResult>>(
  async () => insertOwnerMemberResult,
);

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    auth: { admin: { createUser: createUserMock, deleteUser: deleteUserMock } },
    from: (table: string) => ({
      select: () => ({
        eq: (col: string) => {
          // Chainable so the members lookup (.eq().is().limit().maybeSingle())
          // and the users lookups (.eq().maybeSingle()) share one stub.
          const result = async () =>
            table === "members"
              ? membershipResult
              : col === "phone"
                ? phoneOwnerResult
                : profileResult;
          const node: {
            maybeSingle: typeof result;
            eq: () => typeof node;
            is: () => typeof node;
            order: () => typeof node;
            limit: () => typeof node;
          } = {
            maybeSingle: result,
            eq: () => node,
            is: () => node,
            order: () => node,
            limit: () => node,
          };
          return node;
        },
      }),
    }),
  }),
}));

vi.mock("@/lib/super-admin-provisioning.mjs", () => ({
  // Queue-aware so the email_exists race can be modelled: the first lookup
  // misses, the post-createUser re-query finds the account that won the race.
  findUserByEmail: async () =>
    findUserByEmailQueue.length ? findUserByEmailQueue.shift()! : findUserByEmailResult,
}));

vi.mock("@/services/gyms", () => ({
  gymNameExists: async () => false,
  insertGym: () => insertGymMock(),
  insertOwnerMember: (input: { userId: string }) => insertOwnerMemberMock(input),
  deleteGym: (id: string) => deleteGymMock(id),
  logGymCreated: (id: string, meta: Record<string, unknown>) => logGymCreatedMock(id, meta),
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
  // Interpolating stub. With a bare `(key) => key` the confirmation label was
  // untestable, and review proved it: the whole members.name/display_name/email
  // fallback chain could be replaced by the raw email with every test still
  // passing. Interpolation makes the label assertable.
  getServerTranslation: async () => ({
    t: (key: string, vars?: Record<string, string>) =>
      vars ? key + ":" + Object.values(vars).join(",") : key,
  }),
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
  findUserByEmailQueue = [];
  profileResult = { data: { is_super_admin: false, display_name: "Paul Nkusu" }, error: null };
  phoneOwnerResult = { data: null, error: null };
  membershipResult = { data: { name: "Paul Nkusu" }, error: null };
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
    // The whole point of Story 1.17: the membership must be written for the
    // EXISTING account. Without this the suite would pass while linking the
    // gym to a freshly created id.
    expect(insertOwnerMemberMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "existing-user" }),
    );
  });

  it("screens a raced account for Super Admin before linking it", async () => {
    // The email_exists race branch previously skipped the Super Admin check,
    // which would have granted a platform account a tenant membership.
    createUserResult = { data: null, error: { code: "email_exists" } };
    profileResult = { data: { is_super_admin: true, display_name: "Platform Staff" }, error: null };
    // First lookup misses (so createUser runs and loses the race); the
    // re-query then finds the account that won it.
    findUserByEmailQueue = [null, { id: "super-user", last_sign_in_at: null }];
    const { data, error } = await createGym({ ...VALID, confirmLinkExistingOwner: true });
    expect(data).toBeNull();
    expect(error?.code).toBe("owner_is_super_admin");
  });

  it("refuses a linked owner whose submitted phone belongs to someone else", async () => {
    findUserByEmailResult = { id: "existing-user", last_sign_in_at: "2026-01-01T00:00:00Z" };
    phoneOwnerResult = { data: { id: "a-different-person" }, error: null };
    const { data, error } = await createGym({ ...VALID, confirmLinkExistingOwner: true });
    expect(data).toBeNull();
    expect(error?.code).toBe("owner_phone_belongs_to_other_account");
    expect(insertOwnerMemberMock).not.toHaveBeenCalled();
  });

  it("allows a linked owner whose submitted phone is their own", async () => {
    findUserByEmailResult = { id: "existing-user", last_sign_in_at: "2026-01-01T00:00:00Z" };
    phoneOwnerResult = { data: { id: "existing-user" }, error: null };
    const { error } = await createGym({ ...VALID, confirmLinkExistingOwner: true });
    expect(error).toBeNull();
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
    // The label must name the ACCOUNT (members.name), not echo back the
    // possibly-mistyped email -- an anti-typo control that confirms a typo
    // against itself is worthless.
    expect(error?.message).toContain("Paul Nkusu");
    expect(error?.message).not.toContain(VALID.ownerEmail);
    expect(insertGymMock).not.toHaveBeenCalled(); // the real AC #5 property
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

  it("FAILS CLOSED when the account has no public.users profile", async () => {
    // `profile?.is_super_admin` is falsy when profile is null, so the earlier
    // form let an unclassifiable account through as "not a Super Admin".
    findUserByEmailResult = { id: "ghost-user", last_sign_in_at: null };
    profileResult = { data: null, error: null };
    const { data, error } = await createGym({ ...VALID, confirmLinkExistingOwner: true });
    expect(data).toBeNull();
    expect(error?.code).toBe("owner_profile_missing");
    expect(insertGymMock).not.toHaveBeenCalled();
    expect(insertOwnerMemberMock).not.toHaveBeenCalled();
  });

  it("surfaces a profile-lookup failure instead of proceeding", async () => {
    findUserByEmailResult = { id: "existing-user", last_sign_in_at: null };
    profileResult = { data: null, error: { code: "boom" } };
    const { data, error } = await createGym({ ...VALID, confirmLinkExistingOwner: true });
    expect(data).toBeNull();
    expect(error).not.toBeNull();
    expect(insertGymMock).not.toHaveBeenCalled();
  });

  it("surfaces a phone-lookup failure instead of proceeding", async () => {
    phoneOwnerResult = { data: null, error: { code: "boom" } };
    const { data, error } = await createGym(VALID);
    expect(data).toBeNull();
    expect(error).not.toBeNull();
    expect(createUserMock).not.toHaveBeenCalled();
    expect(insertGymMock).not.toHaveBeenCalled();
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
  it("creates NO auth user at all when the gym insert fails", async () => {
    // Round-2 hoisted account creation above insertGym, which stranded a real
    // auth.users row on a failed gym insert -- unrecoverable, since no admin
    // path deletes an auth user. Round 3 moved provisioning back after the
    // gym insert, so the account is never minted in the first place.
    insertGymResult = { data: null, error: { code: "gym_name_taken", message: "taken" } };
    const { error } = await createGym(VALID);
    expect(error).not.toBeNull();
    expect(createUserMock).not.toHaveBeenCalled();
    expect(deleteUserMock).not.toHaveBeenCalled();
  });

  it("does NOT delete a linked account when the gym insert fails", async () => {
    findUserByEmailResult = { id: "existing-user", last_sign_in_at: "2026-01-01T00:00:00Z" };
    insertGymResult = { data: null, error: { code: "gym_name_taken", message: "taken" } };
    await createGym({ ...VALID, confirmLinkExistingOwner: true });
    expect(deleteUserMock).not.toHaveBeenCalled();
  });

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
