/**
 * Story 9.1 (code review patch): unit tests for `createStaffMember`'s
 * two-step creation sequencing (Dev Notes "Creation Sequencing") -- the
 * service-role admin client provisions `auth.users` first, then
 * `create_staff_member()` runs under the caller's own session, and a failed
 * RPC triggers a compensating `deleteAuthUserForCleanup()` so no orphaned
 * auth user survives a rejected attempt. This sequencing has no pgTAP
 * coverage (it's TypeScript orchestration, not SQL) and no prior Vitest
 * coverage -- mirrors `members.getMemberForInvite.test.ts`'s mocking shape.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

let createUserResult: { data: { user: { id: string } } | null; error: unknown };
let rpcResult: { data: unknown; error: unknown };
let rpcCalls: Array<{ fn: string; params: unknown }>;
let deleteAuthUserForCleanupCalls: string[];

const createUserMock = vi.fn(async () => createUserResult);

function makeAdminStub() {
  return {
    auth: { admin: { createUser: createUserMock } },
  };
}

function makeSupabaseStub() {
  return {
    rpc: vi.fn((fn: string, params: unknown) => {
      rpcCalls.push({ fn, params });
      return Promise.resolve(rpcResult);
    }),
  };
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => makeAdminStub()),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => makeSupabaseStub()),
}));

vi.mock("@/lib/temp-password", () => ({
  generateTempPassword: vi.fn(() => "TempPass1!"),
}));

vi.mock("@/services/members", () => ({
  deleteAuthUserForCleanup: vi.fn(async (userId: string) => {
    deleteAuthUserForCleanupCalls.push(userId);
  }),
}));

vi.mock("@/services/session", () => ({
  mapAndLog: vi.fn(async (err: unknown) => ({
    code: "unknown",
    message: `mapped: ${JSON.stringify(err)}`,
  })),
}));

vi.mock("@/lib/i18n/get-request-locale", () => ({
  getRequestLocale: vi.fn(async () => "en"),
}));

vi.mock("@/lib/i18n/get-server-translation", () => ({
  getServerTranslation: vi.fn(async () => ({ t: (key: string) => key })),
}));

const input = { name: "Jane Coach", phone: "+237680811041", role: "coach" as const };

describe("createStaffMember", () => {
  beforeEach(() => {
    createUserResult = { data: { user: { id: "new-user-1" } }, error: null };
    rpcResult = { data: { id: "member-1", role: "coach" }, error: null };
    rpcCalls = [];
    deleteAuthUserForCleanupCalls = [];
    createUserMock.mockClear();
  });

  it("provisions the auth user, calls the RPC under the caller's own session, and returns the temp password on success", async () => {
    const { createStaffMember } = await import("./staff");

    const result = await createStaffMember(input);

    expect(result).toEqual({ data: { tempPassword: "TempPass1!" }, error: null });
    expect(createUserMock).toHaveBeenCalledWith({
      phone: input.phone,
      password: "TempPass1!",
      phone_confirm: true,
    });
    expect(rpcCalls).toEqual([
      {
        fn: "create_staff_member",
        params: { p_user_id: "new-user-1", p_name: input.name, p_phone: input.phone, p_role: input.role },
      },
    ]);
    expect(deleteAuthUserForCleanupCalls).toEqual([]);
  });

  it("runs a compensating deleteUser and returns a mapped error when the RPC's ceiling check rejects", async () => {
    rpcResult = { data: null, error: { message: "create_staff_member: caller is not authorized to create staff with role coach" } };
    const { createStaffMember } = await import("./staff");

    const result = await createStaffMember(input);

    expect(result.data).toBeNull();
    expect(result.error?.code).toBe("unknown");
    expect(deleteAuthUserForCleanupCalls).toEqual(["new-user-1"]);
  });

  it("never calls the RPC or the compensating cleanup when auth-user provisioning itself fails", async () => {
    createUserResult = { data: null, error: { message: "phone already registered" } };
    const { createStaffMember } = await import("./staff");

    const result = await createStaffMember(input);

    expect(result.data).toBeNull();
    expect(result.error).not.toBeNull();
    expect(rpcCalls).toEqual([]);
    expect(deleteAuthUserForCleanupCalls).toEqual([]);
  });
});
