/**
 * Story 9.2 (Task 11, AC #4): unit tests for `resendStaffTempPassword`'s
 * orchestration -- staff_account_for_reset() RPC (authorization + lookup)
 * -> generate a new temp password -> admin.auth.admin.updateUserById() ->
 * flip users.must_change_password back to true -> best-effort WhatsApp
 * send. Mirrors staff.createStaffMember.test.ts's mocking shape.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

let rpcResult: { data: unknown; error: unknown };
let rpcCalls: Array<{ fn: string; params: unknown }>;
let updateUserByIdResult: { error: unknown };
let updateUserByIdCalls: Array<{ userId: string; attrs: unknown }>;
let usersUpdateResult: { error: unknown };
let usersUpdateCalls: Array<{ attrs: unknown; id: string }>;
let sendEvolutionApiMessageResult: { success: boolean; error: string | null };

const updateUserByIdMock = vi.fn(async (userId: string, attrs: unknown) => {
  updateUserByIdCalls.push({ userId, attrs });
  return updateUserByIdResult;
});
const sendEvolutionApiMessage = vi.fn(async (..._args: unknown[]) => sendEvolutionApiMessageResult);

function makeAdminStub() {
  return {
    auth: { admin: { updateUserById: updateUserByIdMock } },
    from: vi.fn((table: string) => ({
      update: (attrs: unknown) => ({
        eq: async (column: string, id: string) => {
          usersUpdateCalls.push({ attrs, id });
          expect(table).toBe("users");
          expect(column).toBe("id");
          return usersUpdateResult;
        },
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

vi.mock("@/lib/temp-password", () => ({
  generateTempPassword: vi.fn(() => "NewTemp2!"),
}));

vi.mock("@/services/members", () => ({
  deleteAuthUserForCleanup: vi.fn(),
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

vi.mock("@/lib/messaging/EvolutionApiMessageProvider", () => ({
  sendEvolutionApiMessage: (...args: unknown[]) => sendEvolutionApiMessage(...args),
}));

const MEMBER_ID = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
const TARGET_ROW = { user_id: "staff-user-1", phone: "+237680811041", name: "Jane Coach" };

describe("resendStaffTempPassword", () => {
  beforeEach(() => {
    rpcResult = { data: [TARGET_ROW], error: null };
    rpcCalls = [];
    updateUserByIdResult = { error: null };
    updateUserByIdCalls = [];
    usersUpdateResult = { error: null };
    usersUpdateCalls = [];
    sendEvolutionApiMessageResult = { success: true, error: null };
    updateUserByIdMock.mockClear();
    sendEvolutionApiMessage.mockClear();
    process.env.DASHBOARD_APP_URL = "http://127.0.0.1:3000";
  });

  it("calls the RPC, generates a new password, updates auth + must_change_password, sends WhatsApp, and returns { tempPassword, smsSent: true }", async () => {
    const { resendStaffTempPassword } = await import("./staff");

    const result = await resendStaffTempPassword(MEMBER_ID);

    expect(result).toEqual({ data: { tempPassword: "NewTemp2!", smsSent: true }, error: null });
    expect(rpcCalls).toEqual([{ fn: "staff_account_for_reset", params: { p_member_id: MEMBER_ID } }]);
    expect(updateUserByIdCalls).toEqual([{ userId: "staff-user-1", attrs: { password: "NewTemp2!" } }]);
    expect(usersUpdateCalls).toEqual([{ attrs: { must_change_password: true }, id: "staff-user-1" }]);

    expect(sendEvolutionApiMessage).toHaveBeenCalledTimes(1);
    const [phoneArg, messageArg] = sendEvolutionApiMessage.mock.calls[0] as [string, string];
    expect(phoneArg).toBe(TARGET_ROW.phone);
    expect(messageArg).toContain("NewTemp2!");
    expect(messageArg).toContain("http://127.0.0.1:3000/auth/login");
  });

  it("returns { data: null, error } and attempts no auth/users writes when the RPC rejects (not authorized / not found)", async () => {
    rpcResult = { data: null, error: { message: "staff_account_for_reset: caller is not authorized to reset staff passwords" } };
    const { resendStaffTempPassword } = await import("./staff");

    const result = await resendStaffTempPassword(MEMBER_ID);

    expect(result.data).toBeNull();
    expect(result.error).not.toBeNull();
    expect(updateUserByIdCalls).toEqual([]);
    expect(usersUpdateCalls).toEqual([]);
    expect(sendEvolutionApiMessage).not.toHaveBeenCalled();
  });

  it("still returns { tempPassword, smsSent: false } when the WhatsApp send fails -- the password/flag writes are not rolled back", async () => {
    sendEvolutionApiMessageResult = { success: false, error: "gateway unreachable" };
    const { resendStaffTempPassword } = await import("./staff");

    const result = await resendStaffTempPassword(MEMBER_ID);

    expect(result).toEqual({ data: { tempPassword: "NewTemp2!", smsSent: false }, error: null });
    expect(updateUserByIdCalls).toEqual([{ userId: "staff-user-1", attrs: { password: "NewTemp2!" } }]);
    expect(usersUpdateCalls).toEqual([{ attrs: { must_change_password: true }, id: "staff-user-1" }]);
  });

  it("returns { data: null, error } and attempts no users-flag update or WhatsApp send when updateUserById fails", async () => {
    updateUserByIdResult = { error: { message: "auth admin API error" } };
    const { resendStaffTempPassword } = await import("./staff");

    const result = await resendStaffTempPassword(MEMBER_ID);

    expect(result.data).toBeNull();
    expect(result.error).not.toBeNull();
    expect(usersUpdateCalls).toEqual([]);
    expect(sendEvolutionApiMessage).not.toHaveBeenCalled();
  });

  it("still returns { tempPassword, smsSent: true } when the users.must_change_password flag update fails -- the already-changed password is not discarded (code-review fix, 2026-08-19: this used to return { data: null, error }, silently losing the caller's only copy of the new password and locking the account out)", async () => {
    usersUpdateResult = { error: { message: "users update failed" } };
    const { resendStaffTempPassword } = await import("./staff");

    const result = await resendStaffTempPassword(MEMBER_ID);

    expect(result).toEqual({ data: { tempPassword: "NewTemp2!", smsSent: true }, error: null });
    expect(updateUserByIdCalls).toEqual([{ userId: "staff-user-1", attrs: { password: "NewTemp2!" } }]);
    expect(sendEvolutionApiMessage).toHaveBeenCalledTimes(1);
  });
});
