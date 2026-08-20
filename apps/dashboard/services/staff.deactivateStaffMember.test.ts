/**
 * Story 9.3 (Task 16, AC #3): unit tests for `deactivateStaffMember`'s
 * orchestration -- a single `deactivate_staff_member()` RPC call under the
 * caller's own session, returning `{ error }` only (no `data`), matching
 * `deactivateMember()`'s own return shape. No compensating cleanup / WhatsApp
 * send involved -- the RPC itself is the entire write path.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

let rpcResult: { data: unknown; error: unknown };
let rpcCalls: Array<{ fn: string; params: unknown }>;

function makeSupabaseStub() {
  return {
    rpc: vi.fn((fn: string, params: unknown) => {
      rpcCalls.push({ fn, params });
      return Promise.resolve(rpcResult);
    }),
  };
}

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
const input = { reason: "No longer with the gym" };

describe("deactivateStaffMember", () => {
  beforeEach(() => {
    rpcResult = { data: { id: MEMBER_ID }, error: null };
    rpcCalls = [];
  });

  it("calls deactivate_staff_member under the caller's own session and returns { error: null } on success", async () => {
    const { deactivateStaffMember } = await import("./staff");

    const result = await deactivateStaffMember(MEMBER_ID, input);

    expect(rpcCalls).toEqual([
      { fn: "deactivate_staff_member", params: { p_member_id: MEMBER_ID, p_reason: input.reason } },
    ]);
    expect(result).toEqual({ error: null });
  });

  it("returns a mapped error when the RPC's ceiling check rejects", async () => {
    rpcResult = { data: null, error: { message: "deactivate_staff_member: caller is not authorized to deactivate role owner" } };
    const { deactivateStaffMember } = await import("./staff");

    const result = await deactivateStaffMember(MEMBER_ID, input);

    expect(result.error?.code).toBe("unknown");
  });

  it("returns a mapped error when the RPC rejects a self-deactivation attempt", async () => {
    rpcResult = { data: null, error: { message: "deactivate_staff_member: cannot deactivate your own account" } };
    const { deactivateStaffMember } = await import("./staff");

    const result = await deactivateStaffMember(MEMBER_ID, input);

    expect(result.error).not.toBeNull();
  });

  it("returns a mapped error when the RPC rejects an empty/whitespace reason", async () => {
    rpcResult = { data: null, error: { message: "deactivate_staff_member: reason is required" } };
    const { deactivateStaffMember } = await import("./staff");

    const result = await deactivateStaffMember(MEMBER_ID, { reason: "   " });

    expect(result.error).not.toBeNull();
  });
});
