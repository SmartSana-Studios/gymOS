/**
 * Story 9.1 (code review patch) + Story 9.2 (Task 5): unit tests for
 * `createStaffMember`'s two-step creation sequencing (Dev Notes "Creation
 * Sequencing") -- the service-role admin client provisions `auth.users`
 * first, then `create_staff_member()` runs under the caller's own session,
 * and a failed RPC triggers a compensating `deleteAuthUserForCleanup()` so
 * no orphaned auth user survives a rejected attempt.
 *
 * Story 9.4 (Task 9): extends this suite with the new phone-lookup-before-
 * create step (AC #1/#2) -- when `input.phone` already resolves to an
 * existing platform user, `createUser()`/`generateTempPassword()` are
 * skipped entirely and a lighter, no-password notification is sent instead
 * (mirrors `staff.updateStaffRole.test.ts`'s `.maybeSingle()` admin-stub
 * shape for the new `users` lookup, plus a `gyms` lookup on the `supabase`
 * stub and a `getClaims()` stub for `getCallerGymId()`).
 *
 * Story 9.5 (Task 5): extends this suite with `staff_created` analytics
 * capture assertions at both success-return points -- `captureServerEvent`
 * is module-mocked (matching this file's existing dependency-mock shape)
 * rather than exercising the real posthog-node client.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

let createUserResult: { data: { user: { id: string } } | null; error: unknown };
let rpcResult: { data: unknown; error: unknown };
let rpcCalls: Array<{ fn: string; params: unknown }>;
let deleteAuthUserForCleanupCalls: string[];
let sendEvolutionApiMessageResult: { success: boolean; error: string | null };
let usersLookupResult: { data: { id: string } | null; error: unknown };
let usersLookupCalls: Array<{ table: string; column: string; value: string }>;
let gymsLookupResult: { data: { name: string } | null; error: unknown };
let claimsResult: { data: { claims: Record<string, unknown> } | null; error: unknown };

const createUserMock = vi.fn(async () => createUserResult);
const sendEvolutionApiMessage = vi.fn(async (..._args: unknown[]) => sendEvolutionApiMessageResult);

function makeAdminStub() {
  return {
    auth: { admin: { createUser: createUserMock } },
    from: vi.fn((table: string) => ({
      select: (_columns: string) => ({
        eq: (column: string, value: string) => ({
          maybeSingle: async () => {
            usersLookupCalls.push({ table, column, value });
            return usersLookupResult;
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
    auth: { getClaims: vi.fn(async () => claimsResult) },
    from: vi.fn((_table: string) => ({
      select: (_columns: string) => ({
        eq: (_column: string, _value: string) => ({
          maybeSingle: async () => gymsLookupResult,
        }),
      }),
    })),
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
  getServerTranslation: vi.fn(async () => ({
    t: (key: string, vars?: Record<string, unknown>) => (vars ? `${key}(${JSON.stringify(vars)})` : key),
  })),
}));

vi.mock("@/lib/messaging/EvolutionApiMessageProvider", () => ({
  sendEvolutionApiMessage: (...args: unknown[]) => sendEvolutionApiMessage(...args),
}));

const captureServerEvent = vi.fn(async (..._args: unknown[]) => {});

vi.mock("@/lib/analytics", () => ({
  captureServerEvent: (...args: unknown[]) => captureServerEvent(...args),
}));

const input = { name: "Jane Coach", phone: "+237680811041", role: "coach" as const };

describe("createStaffMember", () => {
  beforeEach(() => {
    createUserResult = { data: { user: { id: "new-user-1" } }, error: null };
    rpcResult = { data: { id: "member-1", role: "coach", gym_id: "gym-1" }, error: null };
    rpcCalls = [];
    deleteAuthUserForCleanupCalls = [];
    sendEvolutionApiMessageResult = { success: true, error: null };
    usersLookupResult = { data: null, error: null };
    usersLookupCalls = [];
    gymsLookupResult = { data: { name: "Test Gym" }, error: null };
    claimsResult = { data: { claims: { gym_id: "gym-1", sub: "caller-1" } }, error: null };
    createUserMock.mockClear();
    sendEvolutionApiMessage.mockClear();
    captureServerEvent.mockClear();
    captureServerEvent.mockImplementation(async () => {});
    process.env.DASHBOARD_APP_URL = "http://127.0.0.1:3000";
  });

  it("looks up the phone first; when no existing user is found, provisions the auth user, calls the RPC, sends the temp-password WhatsApp message, and returns { tempPassword, smsSent: true, isExistingAccount: false }", async () => {
    const { createStaffMember } = await import("./staff");

    const result = await createStaffMember(input);

    // The lookup strips the leading "+" before comparing -- GoTrue stores
    // auth.users.phone/public.users.phone without it (confirmed empirically
    // against local Supabase), so a raw input.phone comparison would never
    // match an existing row.
    expect(usersLookupCalls).toEqual([{ table: "users", column: "phone", value: "237680811041" }]);
    expect(result).toEqual({ data: { tempPassword: "TempPass1!", smsSent: true, isExistingAccount: false }, error: null });
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

    // The message actually contains the generated temp password and a
    // login link built from DASHBOARD_APP_URL -- asserted via the mock's
    // captured call args, not a snapshot.
    expect(sendEvolutionApiMessage).toHaveBeenCalledTimes(1);
    const [phoneArg, messageArg] = sendEvolutionApiMessage.mock.calls[0] as [string, string];
    expect(phoneArg).toBe(input.phone);
    expect(messageArg).toContain("TempPass1!");
    expect(messageArg).toContain("http://127.0.0.1:3000/auth/login");

    // Story 9.5: staff_created captured once, attributed to the caller
    // (claims.sub), with no phone/name in the payload.
    expect(captureServerEvent).toHaveBeenCalledTimes(1);
    expect(captureServerEvent).toHaveBeenCalledWith(
      "staff_created",
      { gymId: "gym-1", role: "coach", isExistingAccount: false },
      "caller-1",
    );
  });

  it("returns { tempPassword, smsSent: false } and does NOT roll back the account when the WhatsApp send fails", async () => {
    sendEvolutionApiMessageResult = { success: false, error: "gateway unreachable" };
    const { createStaffMember } = await import("./staff");

    const result = await createStaffMember(input);

    expect(result).toEqual({ data: { tempPassword: "TempPass1!", smsSent: false, isExistingAccount: false }, error: null });
    expect(deleteAuthUserForCleanupCalls).toEqual([]);
  });

  it("runs a compensating deleteUser and returns a mapped error when the RPC's ceiling check rejects, without attempting a WhatsApp send", async () => {
    rpcResult = { data: null, error: { message: "create_staff_member: caller is not authorized to create staff with role coach" } };
    const { createStaffMember } = await import("./staff");

    const result = await createStaffMember(input);

    expect(result.data).toBeNull();
    expect(result.error?.code).toBe("unknown");
    expect(deleteAuthUserForCleanupCalls).toEqual(["new-user-1"]);
    expect(sendEvolutionApiMessage).not.toHaveBeenCalled();
  });

  it("never calls the RPC or the compensating cleanup when auth-user provisioning itself fails", async () => {
    createUserResult = { data: null, error: { message: "phone already registered" } };
    const { createStaffMember } = await import("./staff");

    const result = await createStaffMember(input);

    expect(result.data).toBeNull();
    expect(result.error).not.toBeNull();
    expect(rpcCalls).toEqual([]);
    expect(deleteAuthUserForCleanupCalls).toEqual([]);
    expect(sendEvolutionApiMessage).not.toHaveBeenCalled();
  });

  it("Story 9.4 (AC #1/#2): when the phone already resolves to an existing user, does not call createUser or generate a temp password, calls the RPC with the existing user's id, sends the no-password WhatsApp message, and returns { tempPassword: null, isExistingAccount: true }", async () => {
    usersLookupResult = { data: { id: "existing-user-1" }, error: null };
    const { createStaffMember } = await import("./staff");

    const result = await createStaffMember(input);

    expect(createUserMock).not.toHaveBeenCalled();
    expect(rpcCalls).toEqual([
      {
        fn: "create_staff_member",
        params: { p_user_id: "existing-user-1", p_name: input.name, p_phone: input.phone, p_role: input.role },
      },
    ]);
    expect(result).toEqual({ data: { tempPassword: null, smsSent: true, isExistingAccount: true }, error: null });

    // The no-password message contains the gym name and login link, and
    // never the string "TempPass1!" (the mocked generateTempPassword
    // output) -- proving no password was generated or embedded for this path.
    expect(sendEvolutionApiMessage).toHaveBeenCalledTimes(1);
    const [phoneArg, messageArg] = sendEvolutionApiMessage.mock.calls[0] as [string, string];
    expect(phoneArg).toBe(input.phone);
    expect(messageArg).toContain("Test Gym");
    expect(messageArg).not.toContain("TempPass1!");

    // Story 9.5: staff_created captured once, attributed to the caller
    // (claims.sub), with no phone/name in the payload.
    expect(captureServerEvent).toHaveBeenCalledTimes(1);
    expect(captureServerEvent).toHaveBeenCalledWith(
      "staff_created",
      { gymId: "gym-1", role: "coach", isExistingAccount: true },
      "caller-1",
    );
  });

  it("Story 9.5: an analytics-capture failure does not change createStaffMember's return value or throw", async () => {
    captureServerEvent.mockImplementation(async () => {
      throw new Error("posthog unreachable");
    });
    const { createStaffMember } = await import("./staff");

    const result = await createStaffMember(input);

    expect(result).toEqual({ data: { tempPassword: "TempPass1!", smsSent: true, isExistingAccount: false }, error: null });
  });

  it("Story 9.4: an RPC failure on the existing-account path does not call deleteAuthUserForCleanup (no auth user was created this call)", async () => {
    usersLookupResult = { data: { id: "existing-user-1" }, error: null };
    rpcResult = { data: null, error: { message: "create_staff_member: caller is not authorized to replace a staff member with role owner" } };
    const { createStaffMember } = await import("./staff");

    const result = await createStaffMember(input);

    expect(result.data).toBeNull();
    // mapAndLog is stubbed in this file (see the @/services/session mock
    // above) rather than exercising the real mapSupabaseError -- asserting
    // the mocked code/message shape still confirms the RPC's error is
    // actually threaded through mapAndLog and returned, matching the
    // adjacent phone-lookup-error test's own assertion shape below.
    expect(result.error?.code).toBe("unknown");
    expect(deleteAuthUserForCleanupCalls).toEqual([]);
    expect(sendEvolutionApiMessage).not.toHaveBeenCalled();
  });

  it("Story 9.4: a phone-lookup error is mapped and returned before any provisioning is attempted", async () => {
    usersLookupResult = { data: null, error: { message: "lookup failed" } };
    const { createStaffMember } = await import("./staff");

    const result = await createStaffMember(input);

    expect(result.data).toBeNull();
    expect(result.error?.code).toBe("unknown");
    expect(createUserMock).not.toHaveBeenCalled();
    expect(rpcCalls).toEqual([]);
  });

  it("Story 9.4: a failed gym-name lookup on the existing-account path is non-blocking -- the notification still sends and the call still succeeds", async () => {
    usersLookupResult = { data: { id: "existing-user-1" }, error: null };
    claimsResult = { data: null, error: { message: "getClaims failed" } };
    const { createStaffMember } = await import("./staff");

    const result = await createStaffMember(input);

    expect(result).toEqual({ data: { tempPassword: null, smsSent: true, isExistingAccount: true }, error: null });
    expect(sendEvolutionApiMessage).toHaveBeenCalledTimes(1);
  });
});
