/**
 * Story 4.12 (Task 2, AC #1): unit tests for `getRenewalPreview`'s new
 * `memberPhone` field -- the source of the phone number
 * `initiatePaymentAction` needs to trigger a real Tara Money charge.
 * Everything else about this function (plan/price resolution, the
 * `not_found` collapsing) is Story 4.7's own concern and already stable --
 * this suite only exercises what this story actually changed. Mocks
 * `@/lib/supabase/server`'s `createClient()` with a small chainable
 * query-builder stub, matching `members.getMemberForInvite.test.ts`'s
 * established convention for this same boundary.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

let claimsResult: { data: { claims: Record<string, unknown> | null } | null; error: unknown };
let subscriptionRow: { plans: { name: string; price: number; currency: string } | null; members: { phone: string | null } | null } | null;
let queryError: unknown;

function makeSupabaseStub() {
  return {
    auth: {
      getClaims: vi.fn(async () => claimsResult),
    },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            order: vi.fn(() => ({
              limit: vi.fn(() => ({
                maybeSingle: vi.fn(async () => ({ data: subscriptionRow, error: queryError })),
              })),
            })),
          })),
        })),
      })),
    })),
  };
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => makeSupabaseStub()),
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

describe("getRenewalPreview", () => {
  beforeEach(() => {
    claimsResult = { data: { claims: { gym_id: "gym-1" } }, error: null };
    subscriptionRow = {
      plans: { name: "Monthly", price: 15000, currency: "XAF" },
      members: { phone: "+237680811041" },
    };
    queryError = null;
  });

  it("returns the member's phone alongside plan/price when one is on file", async () => {
    const { getRenewalPreview } = await import("./subscriptions");

    const result = await getRenewalPreview("member-1");

    expect(result).toEqual({
      data: { planName: "Monthly", price: 15000, currency: "XAF", memberPhone: "+237680811041" },
      error: null,
    });
  });

  it("returns memberPhone: null when the member has no phone on file, without erroring", async () => {
    subscriptionRow = { plans: { name: "Monthly", price: 15000, currency: "XAF" }, members: { phone: null } };
    const { getRenewalPreview } = await import("./subscriptions");

    const result = await getRenewalPreview("member-1");

    expect(result.data?.memberPhone).toBeNull();
    expect(result.error).toBeNull();
  });

  it("returns memberPhone: null (not a crash) when the members embed itself is absent", async () => {
    subscriptionRow = { plans: { name: "Monthly", price: 15000, currency: "XAF" }, members: null };
    const { getRenewalPreview } = await import("./subscriptions");

    const result = await getRenewalPreview("member-1");

    expect(result.data?.memberPhone).toBeNull();
  });

  it("still returns not_found when there is no subscription/plan at all, unaffected by the new field", async () => {
    subscriptionRow = null;
    const { getRenewalPreview } = await import("./subscriptions");

    const result = await getRenewalPreview("member-1");

    expect(result.data).toBeNull();
    expect(result.error?.code).toBe("not_found");
  });
});
