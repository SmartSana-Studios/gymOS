import { describe, expect, it, vi } from "vitest";

// Migration 0193: the database refuses to reactivate a gym that billing suspended; updateGymStatus turns that raise into a plain message for the Super Admin.
let reads = 0;
let updateResult: { data: { id: string } | null; error: { message: string; code?: string } | null };
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => {
      const q: Record<string, unknown> = {};
      q.select = () => q;
      q.eq = () => q;
      q.update = () => q;
      // The first read is the gym's current status, the second is the UPDATE's own result.
      q.maybeSingle = async () => (++reads % 2 === 1 ? { data: { status: "suspended" }, error: null } : updateResult);
      return q;
    },
  }),
}));

vi.mock("@/lib/i18n/get-request-locale", () => ({ getRequestLocale: async () => "en" }));
vi.mock("@/lib/i18n/get-server-translation", () => ({
  getServerTranslation: async () => ({ t: (k: string, v?: Record<string, string>) => (v ? `${k}|${JSON.stringify(v)}` : k) }),
}));

import { updateGymStatus } from "./gyms";

describe("updateGymStatus with a billing-suspended gym", () => {
  it("returns a billing_unpaid error with the localized message when the database refuses the reactivation", async () => {
    reads = 0;
    updateResult = { data: null, error: { message: "gym_reactivation_requires_payment: 2026-11-04", code: "P0001" } };
    const result = await updateGymStatus("00000000-0000-4000-8000-000000000001", "active");
    expect(result.data).toBeNull();
    expect(result.error).toEqual({ code: "billing_unpaid", message: 'gyms.errors.reactivationRequiresPayment|{"date":"2026-11-04"}' });
  });

  it("falls back to the message without a date when the raise carries none", async () => {
    reads = 0;
    updateResult = { data: null, error: { message: "gym_reactivation_requires_payment", code: "P0001" } };
    const result = await updateGymStatus("00000000-0000-4000-8000-000000000001", "active");
    expect(result.error).toEqual({ code: "billing_unpaid", message: "gyms.errors.reactivationRequiresPaymentNoDate" });
  });

  it("still maps any other database error through the shared mapper", async () => {
    reads = 0;
    updateResult = { data: null, error: { message: "something else", code: "XX000" } };
    const result = await updateGymStatus("00000000-0000-4000-8000-000000000001", "active");
    expect(result.error?.code).not.toBe("billing_unpaid");
  });
});
