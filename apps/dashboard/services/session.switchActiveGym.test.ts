/**
 * Story 9.6 (Task 5): unit tests for `switchActiveGym`'s orchestration --
 * calls `switch_active_gym()` RPC, and only on success calls
 * `refreshSession()`. Mirrors staff.resendStaffTempPassword.test.ts's
 * mocking shape, adapted since switchActiveGym lives in the same module
 * (session.ts) as mapAndLog -- its real dependencies (getRequestLocale,
 * mapSupabaseError) are mocked instead of mocking session.ts itself.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

let rpcResult: { error: unknown };
let rpcCalls: Array<{ fn: string; params: unknown }>;
let refreshSessionResult: { error: unknown };
let refreshSessionCalls: number;

const refreshSessionMock = vi.fn();

function makeSupabaseStub() {
  return {
    rpc: vi.fn((fn: string, params: unknown) => {
      rpcCalls.push({ fn, params });
      return Promise.resolve(rpcResult);
    }),
    auth: {
      refreshSession: refreshSessionMock,
    },
  };
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => makeSupabaseStub()),
}));

vi.mock("@/lib/i18n/get-request-locale", () => ({
  getRequestLocale: vi.fn(async () => "en"),
}));

vi.mock("@/lib/i18n/get-server-translation", () => ({
  getServerTranslation: vi.fn(async () => ({
    t: (key: string) => key,
  })),
}));

vi.mock("@gymos/types", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@gymos/types")>();
  return {
    ...actual,
    mapSupabaseError: vi.fn((error: unknown) => ({
      code: "unknown",
      message: `mapped: ${JSON.stringify(error)}`,
    })),
  };
});

const GYM_ID = "3fa85f64-5717-4562-b3fc-2c963f66afa6";

describe("switchActiveGym", () => {
  beforeEach(() => {
    rpcResult = { error: null };
    rpcCalls = [];
    refreshSessionResult = { error: null };
    refreshSessionCalls = 0;
    refreshSessionMock.mockReset();
    refreshSessionMock.mockImplementation(async () => {
      refreshSessionCalls += 1;
      return refreshSessionResult;
    });
  });

  it("calls switch_active_gym() and refreshSession() on success, returning { error: null }", async () => {
    const { switchActiveGym } = await import("./session");

    const result = await switchActiveGym(GYM_ID);

    expect(result).toEqual({ error: null });
    expect(rpcCalls).toEqual([{ fn: "switch_active_gym", params: { p_gym_id: GYM_ID } }]);
    expect(refreshSessionCalls).toBe(1);
  });

  it("does NOT call refreshSession() when the RPC rejects -- never refreshes a session that never actually changed server-side", async () => {
    rpcResult = { error: { message: "switch_active_gym: caller has no active membership at target gym" } };
    const { switchActiveGym } = await import("./session");

    const result = await switchActiveGym(GYM_ID);

    expect(result.error).not.toBeNull();
    expect(refreshSessionCalls).toBe(0);
  });

  it("retries refreshSession() once after a successful RPC, returning { error: null } if the retry succeeds", async () => {
    let calls = 0;
    refreshSessionMock.mockImplementation(async () => {
      calls += 1;
      refreshSessionCalls += 1;
      return calls === 1 ? { error: { message: "transient network error" } } : { error: null };
    });
    const { switchActiveGym } = await import("./session");

    const result = await switchActiveGym(GYM_ID);

    expect(result).toEqual({ error: null });
    expect(refreshSessionCalls).toBe(2);
  });

  it("returns an error only after refreshSession() fails twice in a row following a successful RPC", async () => {
    refreshSessionResult = { error: { message: "network error" } };
    const { switchActiveGym } = await import("./session");

    const result = await switchActiveGym(GYM_ID);

    expect(result.error).not.toBeNull();
    expect(refreshSessionCalls).toBe(2);
  });
});
