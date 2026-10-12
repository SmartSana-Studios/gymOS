/**
 * Story 19.9b: getSessionPaymentPreview (plan must be Pay-per-session with a
 * price) and searchMembersForPayment's planType (newest subscription wins).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

let result: { data: unknown; error: unknown };

function from() {
  const b: Record<string, unknown> = {};
  for (const m of ["select", "eq", "is", "or", "order", "limit"]) b[m] = () => b;
  b.maybeSingle = async () => result;
  b.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve);
  return b;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getClaims: async () => ({ data: { claims: { gym_id: "gym-1" } }, error: null }) },
    from,
  })),
}));
vi.mock("@/services/session", () => ({ mapAndLog: vi.fn(async () => ({ code: "unknown", message: "m" })) }));
vi.mock("@/lib/i18n/get-request-locale", () => ({ getRequestLocale: vi.fn(async () => "en") }));
vi.mock("@/lib/i18n/get-server-translation", () => ({
  getServerTranslation: vi.fn(async () => ({ t: (k: string) => k })),
}));

const plan = (o: Record<string, unknown> = {}) => ({
  plans: { name: "Drop-in", plan_type: "pay_per_session", price: 2000, currency: "XAF", ...o },
});

describe("getSessionPaymentPreview", () => {
  beforeEach(() => {
    result = { data: plan(), error: null };
  });

  it("returns the plan price for a Pay-per-session plan", async () => {
    const { getSessionPaymentPreview } = await import("./payments");
    const { data, error } = await getSessionPaymentPreview("m1");
    expect(error).toBeNull();
    expect(data).toEqual({ planName: "Drop-in", planType: "pay_per_session", price: 2000, currency: "XAF" });
  });

  it("gives not_found when the member has no plan", async () => {
    result = { data: null, error: null };
    const { getSessionPaymentPreview } = await import("./payments");
    expect((await getSessionPaymentPreview("m1")).error?.code).toBe("not_found");
  });

  it("refuses a plan that is not Pay-per-session", async () => {
    result = { data: plan({ plan_type: "monthly" }), error: null };
    const { getSessionPaymentPreview } = await import("./payments");
    const { data, error } = await getSessionPaymentPreview("m1");
    expect(data).toBeNull();
    expect(error).toEqual({ code: "plan_not_per_session", message: "sessionPayment.errors.planNotPerSession" });
  });

  it("refuses a price of 0", async () => {
    result = { data: plan({ price: 0 }), error: null };
    const { getSessionPaymentPreview } = await import("./payments");
    const { data, error } = await getSessionPaymentPreview("m1");
    expect(data).toBeNull();
    expect(error).toEqual({ code: "session_price_not_set", message: "sessionPayment.errors.sessionPriceNotSet" });
  });
});

describe("searchMembersForPayment planType", () => {
  it("uses the newest subscription's plan, accepting array or object embeds", async () => {
    result = {
      data: [
        {
          id: "m1",
          name: "Alice",
          phone: null,
          subscriptions: [
            { created_at: "2026-01-01T00:00:00Z", plans: { plan_type: "monthly" } },
            { created_at: "2026-09-01T00:00:00Z", plans: [{ plan_type: "pay_per_session" }] },
          ],
        },
        { id: "m2", name: "Bob", phone: null, subscriptions: [] },
      ],
      error: null,
    };
    const { searchMembersForPayment } = await import("./payments");
    const { data } = await searchMembersForPayment("a");
    expect(data?.map((m) => [m.id, m.planType])).toEqual([
      ["m1", "pay_per_session"],
      ["m2", null],
    ]);
  });
});
