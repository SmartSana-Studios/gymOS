/**
 * Story 9.3 (Task 16, AC #1/#2): unit tests for `updateStaffRole`'s
 * orchestration -- a single `update_staff_role()` RPC call under the
 * caller's own session, followed by a `users.must_change_password` lookup
 * (via the admin client) so the returned row's `status` accurately reflects
 * pending-activation state rather than assuming "active". No compensating
 * cleanup / multi-step sequencing here (unlike `createStaffMember`), so this
 * suite is a lower-risk regression surface than Stories 9.1/9.2's own
 * mocking-heavy suites -- neither WhatsApp nor auth-admin writes are
 * involved. Mirrors `staff.createStaffMember.test.ts`'s mocking shape.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

let rpcResult: { data: unknown; error: unknown };
let rpcCalls: Array<{ fn: string; params: unknown }>;
let usersSelectResult: { data: unknown; error: unknown };
let usersSelectCalls: Array<{ table: string; column: string; id: string }>;

function makeAdminStub() {
  return {
    from: vi.fn((table: string) => ({
      select: (_columns: string) => ({
        eq: (column: string, id: string) => ({
          single: async () => {
            usersSelectCalls.push({ table, column, id });
            return usersSelectResult;
          },
        }),
      }),
    })),
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
  getServerTranslation: vi.fn(async () => ({
    t: (key: string, vars?: Record<string, unknown>) => (vars ? `${key}(${JSON.stringify(vars)})` : key),
  })),
}));

const MEMBER_ID = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
const UPDATED_ROW = { id: MEMBER_ID, name: "Jane Manager", phone: "+237680811041", role: "manager", user_id: "staff-user-1" };
const input = { name: "Jane Manager", role: "manager" as const };

describe("updateStaffRole", () => {
  beforeEach(() => {
    rpcResult = { data: UPDATED_ROW, error: null };
    rpcCalls = [];
    usersSelectResult = { data: { must_change_password: false }, error: null };
    usersSelectCalls = [];
  });

  it("calls update_staff_role under the caller's own session and returns the updated row with status='active'", async () => {
    const { updateStaffRole } = await import("./staff");

    const result = await updateStaffRole(MEMBER_ID, input);

    expect(rpcCalls).toEqual([
      { fn: "update_staff_role", params: { p_member_id: MEMBER_ID, p_name: input.name, p_role: input.role } },
    ]);
    expect(usersSelectCalls).toEqual([{ table: "users", column: "id", id: "staff-user-1" }]);
    expect(result).toEqual({
      data: { id: MEMBER_ID, name: "Jane Manager", phone: "+237680811041", role: "manager", status: "active" },
      error: null,
    });
  });

  it("returns status='pending_activation' when the target's must_change_password is still true", async () => {
    usersSelectResult = { data: { must_change_password: true }, error: null };
    const { updateStaffRole } = await import("./staff");

    const result = await updateStaffRole(MEMBER_ID, input);

    expect(result.data?.status).toBe("pending_activation");
  });

  it("returns a mapped error and does not attempt the must_change_password lookup when the RPC's ceiling check rejects", async () => {
    rpcResult = { data: null, error: { message: "update_staff_role: caller is not authorized to assign role manager" } };
    const { updateStaffRole } = await import("./staff");

    const result = await updateStaffRole(MEMBER_ID, input);

    expect(result.data).toBeNull();
    expect(result.error?.code).toBe("unknown");
    expect(usersSelectCalls).toEqual([]);
  });

  it("returns a mapped error and does not attempt the must_change_password lookup when the RPC rejects the self-edit", async () => {
    rpcResult = { data: null, error: { message: "update_staff_role: cannot edit your own role" } };
    const { updateStaffRole } = await import("./staff");

    const result = await updateStaffRole(MEMBER_ID, input);

    expect(result.data).toBeNull();
    expect(usersSelectCalls).toEqual([]);
  });

  it("returns a mapped error when the must_change_password lookup itself fails", async () => {
    usersSelectResult = { data: null, error: { message: "users lookup failed" } };
    const { updateStaffRole } = await import("./staff");

    const result = await updateStaffRole(MEMBER_ID, input);

    expect(result.data).toBeNull();
    expect(result.error?.code).toBe("unknown");
  });
});
