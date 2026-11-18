/**
 * Story 27.4: the member read's subscriptions embed carries the subscription id and start date and the plan's price, duration and billing
 * interval (MEMBER_SUBSCRIPTION_EMBED), and toMemberListRow maps them onto the row the Correct plan button, "Subscription started" and the
 * plan summary line read. A member with no subscription gets nulls.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/services/session", () => ({ mapAndLog: vi.fn() }));
vi.mock("@/lib/i18n/get-request-locale", () => ({ getRequestLocale: vi.fn(async () => "en") }));
vi.mock("@/lib/i18n/get-server-translation", () => ({ getServerTranslation: vi.fn(async () => ({ t: (key: string) => key })) }));

import { MEMBER_SUBSCRIPTION_EMBED, toMemberListRow, type MemberRowFromDb } from "./members.shared";

const BASE = {
  id: "m-1", name: "Ange T.", phone: null, email: null, dob: null, photo_url: null, emergency_contact: null,
  join_date: "2026-01-01", deactivated_at: null, registration_fee_settled_at: null,
} satisfies Omit<MemberRowFromDb, "subscriptions">;

describe("toMemberListRow subscription fields (Story 27.4)", () => {
  it("maps the real embed shape: id, start_date and plans(price, duration_days, billing_interval)", () => {
    const row = toMemberListRow({
      ...BASE,
      subscriptions: [
        {
          id: "sub-1",
          status: "active",
          expiry_date: "2027-11-02",
          start_date: "2026-11-02",
          plan_id: "plan-1",
          created_at: "2026-11-02T10:00:00Z",
          plans: { name: "ANNUAL", plan_type: "monthly", price: 250000, duration_days: 365, billing_interval: "annual" },
        },
      ],
    });
    expect(row).toMatchObject({
      subscriptionId: "sub-1",
      subscriptionStartDate: "2026-11-02",
      planPrice: 250000,
      planDurationDays: 365,
      planBillingInterval: "annual",
      planId: "plan-1",
      planName: "ANNUAL",
    });
  });

  it("a Pay-per-session plan has no duration", () => {
    const row = toMemberListRow({
      ...BASE,
      subscriptions: [
        { id: "s", status: "active", expiry_date: null, start_date: "2026-11-02", plan_id: "p", created_at: "x", plans: { name: "DROP-IN", plan_type: "pay_per_session", price: 2000, duration_days: null, billing_interval: "monthly" } },
      ],
    });
    expect(row.planDurationDays).toBeNull();
    expect(row.planPrice).toBe(2000);
  });

  it("a member with no subscription gets nulls", () => {
    expect(toMemberListRow({ ...BASE, subscriptions: [] })).toMatchObject({
      subscriptionId: null, subscriptionStartDate: null, planPrice: null, planDurationDays: null, planBillingInterval: null,
    });
  });

  it("the embed selects every column the mapping reads", () => {
    for (const column of ["id", "start_date", "price", "duration_days", "billing_interval", "plan_type"]) {
      expect(MEMBER_SUBSCRIPTION_EMBED).toContain(column);
    }
  });
});
