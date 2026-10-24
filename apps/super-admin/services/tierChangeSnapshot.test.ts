import { describe, expect, it, vi } from "vitest";

// Moving a gym between tiers must record the tiers' names and prices as they
// were at that moment (tiers can later be edited or deleted).
const OLD = { id: "t-old", name: "Starter", member_cap: 50, monthly_price: 5000, annual_price: 50000 };
const NEW = { id: "t-new", name: "Unlimited", member_cap: null, monthly_price: 15000, annual_price: 150000 };

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      const q: Record<string, unknown> = {};
      q.select = () => q;
      q.eq = () => q;
      q.update = () => q;
      q.in = () => Promise.resolve({ data: [OLD, NEW], error: null });
      q.maybeSingle = () =>
        Promise.resolve({ data: table === "gyms" ? { id: "g", tier_id: OLD.id } : null, error: null });
      return q;
    },
  }),
}));
vi.mock("@/lib/i18n/get-request-locale", () => ({ getRequestLocale: async () => "en" }));
vi.mock("@/lib/i18n/get-server-translation", () => ({
  getServerTranslation: async () => ({ t: (k: string) => k }),
}));

import { tierAuditFields, updateGymTier } from "./gyms";

describe("tier change audit snapshot", () => {
  it("updateGymTier returns both tiers as they stand now", async () => {
    const { data } = await updateGymTier("g", NEW.id);
    expect(data?.previousTierId).toBe(OLD.id);
    expect(data?.tiers.map((t) => t.name).sort()).toEqual(["Starter", "Unlimited"]);
  });

  it("tierAuditFields flattens name, cap and prices, and tolerates a missing tier", () => {
    expect(
      tierAuditFields("new_tier", { id: "x", name: "Unlimited", memberCap: null, monthlyPrice: 15000, annualPrice: 150000 }),
    ).toEqual({
      new_tier_name: "Unlimited",
      new_tier_member_cap: null,
      new_tier_monthly_price: 15000,
      new_tier_annual_price: 150000,
    });
    expect(tierAuditFields("previous_tier", undefined)).toEqual({});
  });
});
