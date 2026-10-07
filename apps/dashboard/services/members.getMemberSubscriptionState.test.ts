/**
 * Story 18.5: `getMemberSubscriptionState` is the pre-read `assignInitialPlan`
 * uses. It scopes both reads to the caller's gym, resolves a missing or
 * cross-gym member to not_found, and reports whether ANY subscription row exists
 * (a settled member with a subscription may not receive a "first" plan).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

let memberResult: { data: { id: string } | null; error: unknown };
let subscriptionResult: { count: number | null; error: unknown };
let eqCalls: Array<[string, string, unknown]>;

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getClaims: async () => ({ data: { claims: { gym_id: "gym-1" } }, error: null }) },
    from: (table: string) => {
      const builder: Record<string, unknown> = {};
      builder.select = () => builder;
      builder.eq = (column: string, value: unknown) => {
        eqCalls.push([table, column, value]);
        return builder;
      };
      builder.maybeSingle = async () => memberResult;
      builder.then = (resolve: (value: typeof subscriptionResult) => unknown) => resolve(subscriptionResult);
      return builder;
    },
  })),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/services/session", () => ({ mapAndLog: vi.fn(async () => ({ code: "unknown", message: "mapped" })) }));
vi.mock("@/lib/i18n/get-request-locale", () => ({ getRequestLocale: vi.fn(async () => "en") }));
vi.mock("@/lib/i18n/get-server-translation", () => ({
  getServerTranslation: vi.fn(async () => ({ t: (key: string) => key })),
}));

describe("getMemberSubscriptionState (Story 18.5)", () => {
  beforeEach(() => {
    eqCalls = [];
    memberResult = { data: { id: "m1" }, error: null };
    subscriptionResult = { count: 0, error: null };
  });

  it("reports no subscription and the caller's gym id", async () => {
    const { getMemberSubscriptionState } = await import("./members");

    const result = await getMemberSubscriptionState("m1");

    expect(result).toEqual({ data: { gymId: "gym-1", hasSubscription: false }, error: null });
    expect(eqCalls).toContainEqual(["members", "gym_id", "gym-1"]);
    expect(eqCalls).toContainEqual(["members", "role", "member"]);
    expect(eqCalls).toContainEqual(["subscriptions", "gym_id", "gym-1"]);
    expect(eqCalls).toContainEqual(["subscriptions", "member_id", "m1"]);
  });

  it("reports an existing subscription of any status", async () => {
    subscriptionResult = { count: 1, error: null };
    const { getMemberSubscriptionState } = await import("./members");

    const result = await getMemberSubscriptionState("m1");

    expect(result.data?.hasSubscription).toBe(true);
  });

  it("returns not_found for a stale, cross-gym or non-member id", async () => {
    memberResult = { data: null, error: null };
    const { getMemberSubscriptionState } = await import("./members");

    const result = await getMemberSubscriptionState("m-missing");

    expect(result.data).toBeNull();
    expect(result.error?.code).toBe("not_found");
  });

  it("returns a mapped error on a query failure", async () => {
    subscriptionResult = { count: null, error: { message: "reset" } };
    const { getMemberSubscriptionState } = await import("./members");

    const result = await getMemberSubscriptionState("m1");

    expect(result.data).toBeNull();
    expect(result.error).toEqual({ code: "unknown", message: "mapped" });
  });
});
