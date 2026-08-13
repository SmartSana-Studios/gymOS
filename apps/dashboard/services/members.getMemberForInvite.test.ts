/**
 * Story 2.10 (Task 2, AC #1, #3, #4): unit tests for `getMemberForInvite`,
 * the new single-member fetch-by-id this story adds to services/members.ts.
 * Exercises the actual gym-scoping (`getCallerGymId`) and not-found
 * collapsing (missing row vs. null phone -> the same outcome) logic --
 * `@/lib/supabase/server`'s `createClient()` is mocked with a small
 * chainable query-builder stub rather than hitting a real database, matching
 * this app's Server Action/service boundary.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

let claimsResult: { data: { claims: Record<string, unknown> | null } | null; error: unknown };
let memberRow: { name: string; phone: string | null } | null;
let memberQueryError: unknown;
let eqCalls: Array<[string, unknown]>;
let isCalls: Array<[string, unknown]>;

function makeSupabaseStub() {
  return {
    auth: {
      getClaims: vi.fn(async () => claimsResult),
    },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn((column: string, value: unknown) => {
          eqCalls.push([column, value]);
          return {
            eq: vi.fn((column: string, value: unknown) => {
              eqCalls.push([column, value]);
              return {
                eq: vi.fn((column: string, value: unknown) => {
                  eqCalls.push([column, value]);
                  return {
                    is: vi.fn((column: string, value: unknown) => {
                      isCalls.push([column, value]);
                      return {
                        maybeSingle: vi.fn(async () => ({ data: memberRow, error: memberQueryError })),
                      };
                    }),
                  };
                }),
              };
            }),
          };
        }),
      })),
    })),
  };
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => makeSupabaseStub()),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

vi.mock("@/services/session", () => ({
  mapAndLog: vi.fn(async () => ({ code: "unknown", message: "mapped error" })),
}));

vi.mock("@/lib/i18n/get-request-locale", () => ({
  getRequestLocale: vi.fn(async () => "en"),
}));

vi.mock("@/lib/i18n/get-server-translation", () => ({
  getServerTranslation: vi.fn(async () => ({ t: (key: string) => key })),
}));

describe("getMemberForInvite", () => {
  beforeEach(() => {
    claimsResult = { data: { claims: { gym_id: "gym-1" } }, error: null };
    memberRow = { name: "Alice", phone: "+237680811041" };
    memberQueryError = null;
    eqCalls = [];
    isCalls = [];
  });

  it("returns name/phone for a member belonging to the caller's gym", async () => {
    const { getMemberForInvite } = await import("./members");

    const result = await getMemberForInvite("member-1");

    expect(result).toEqual({ data: { name: "Alice", phone: "+237680811041" }, error: null });
  });

  it("code review fix: scopes the lookup to role='member' and excludes deactivated rows -- a coach/manager/owner id or a deactivated member must not resolve, since gym_staff_read_own_members RLS (0018) alone permits reading every role in the gym", async () => {
    const { getMemberForInvite } = await import("./members");

    await getMemberForInvite("member-1");

    expect(eqCalls).toContainEqual(["role", "member"]);
    expect(isCalls).toContainEqual(["deactivated_at", null]);
  });

  it("returns not_found when no row matches (stale id or cross-gym id)", async () => {
    memberRow = null;
    const { getMemberForInvite } = await import("./members");

    const result = await getMemberForInvite("member-missing");

    expect(result.data).toBeNull();
    expect(result.error?.code).toBe("not_found");
  });

  it("returns not_found when the member has no phone on file (nothing to invite)", async () => {
    memberRow = { name: "Alice", phone: null };
    const { getMemberForInvite } = await import("./members");

    const result = await getMemberForInvite("member-1");

    expect(result.data).toBeNull();
    expect(result.error?.code).toBe("not_found");
  });

  it("returns not_found (via the no-gym-claim branch) when the caller's session has no gym_id claim", async () => {
    claimsResult = { data: { claims: {} }, error: null };
    const { getMemberForInvite } = await import("./members");

    const result = await getMemberForInvite("member-1");

    expect(result.data).toBeNull();
    expect(result.error?.code).toBe("not_found");
  });

  it("propagates a mapped error (not a thrown exception) on a genuine query failure", async () => {
    memberQueryError = { message: "connection reset" };
    const { getMemberForInvite } = await import("./members");

    const result = await getMemberForInvite("member-1");

    expect(result.data).toBeNull();
    expect(result.error).toEqual({ code: "unknown", message: "mapped error" });
  });
});
