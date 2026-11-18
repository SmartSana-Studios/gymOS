/**
 * Story 27.4: the service half of Correct plan. The database refuses with P0001, the code as the message and a JSON detail; the service
 * parses that into a typed refusal the modal renders as the matching F state, maps "permission denied" to F12, and returns anything else
 * as an error. The eligibility row maps to a subscription and, when a payment stands, the block (state, amount, method, date, refunded
 * amount, the count of the others).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => ({ rpc })) }));
vi.mock("@/services/session", () => ({ mapAndLog: vi.fn(async () => ({ code: "unknown", message: "mapped error" })) }));
vi.mock("@/lib/i18n/get-request-locale", () => ({ getRequestLocale: vi.fn(async () => "en") }));
vi.mock("@/lib/i18n/get-server-translation", () => ({ getServerTranslation: vi.fn(async () => ({ t: (key: string) => key })) }));

import { correctSubscriptionPlan, getCorrectPlanEligibility, parseCorrectPlanRefusal } from "./members.correctPlan";

const p0001 = (message: string, details: unknown = "{}") => ({ code: "P0001", message, details });

describe("parseCorrectPlanRefusal", () => {
  it.each(["no_current_subscription", "subscription_changed", "plan_not_found", "same_plan", "invalid_reason"])("%s", (code) => {
    expect(parseCorrectPlanRefusal(p0001(code))).toEqual({ code });
  });

  it("payment_stands carries the block", () => {
    const detail = JSON.stringify({ state: "partly_refunded", payment_id: "p", amount: 250000, method: "cash", created_at: "2026-11-10T09:00:00Z", on: "2026-11-10", refunded_amount: 100000, more: 2 });
    expect(parseCorrectPlanRefusal(p0001("payment_stands", detail))).toEqual({
      code: "payment_stands",
      block: { state: "partly_refunded", amount: 250000, method: "cash", createdAt: "2026-11-10T09:00:00Z", on: "2026-11-10", refundedAmount: 100000, more: 2 },
    });
  });

  it("session_held carries the soonest lapse date", () => {
    expect(parseCorrectPlanRefusal(p0001("session_held", JSON.stringify({ lapses_at: "x", lapses_on: "2026-11-20" })))).toEqual({ code: "session_held", lapsesOn: "2026-11-20" });
  });

  it("anything else is not a refusal", () => {
    expect(parseCorrectPlanRefusal(p0001("something_else"))).toBeNull();
    expect(parseCorrectPlanRefusal({ code: "42501", message: "same_plan" })).toBeNull();
    expect(parseCorrectPlanRefusal(p0001("payment_stands", "not json"))).toBeNull();
    expect(parseCorrectPlanRefusal(null)).toBeNull();
  });
});

describe("correctSubscriptionPlan", () => {
  beforeEach(() => rpc.mockReset());

  it("calls the function with the optional subscription id only when one is given", async () => {
    rpc.mockResolvedValue({ data: [{ subscription_id: "s", plan_id: "p", plan_name: "MONTHLY", plan_type: "monthly", expiry_date: "2026-12-02", status: "active" }], error: null });
    const result = await correctSubscriptionPlan({ memberId: "m", newPlanId: "p", reason: "Wrong plan", subscriptionId: "s" });
    expect(rpc).toHaveBeenCalledWith("correct_subscription_plan", { p_member_id: "m", p_new_plan_id: "p", p_reason: "Wrong plan", p_subscription_id: "s" });
    expect(result.data).toEqual({ subscriptionId: "s", planId: "p", planName: "MONTHLY", planType: "monthly", expiryDate: "2026-12-02", status: "active" });
    await correctSubscriptionPlan({ memberId: "m", newPlanId: "p", reason: "Wrong plan" });
    expect(rpc).toHaveBeenLastCalledWith("correct_subscription_plan", { p_member_id: "m", p_new_plan_id: "p", p_reason: "Wrong plan" });
  });

  it("returns a refusal as data, permission loss as its own flag, and any other failure as an error", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: p0001("same_plan") });
    expect(await correctSubscriptionPlan({ memberId: "m", newPlanId: "p", reason: "Wrong plan" })).toMatchObject({ refusal: { code: "same_plan" }, error: null, permissionDenied: false });
    rpc.mockResolvedValueOnce({ data: null, error: p0001("permission denied") });
    expect(await correctSubscriptionPlan({ memberId: "m", newPlanId: "p", reason: "Wrong plan" })).toMatchObject({ permissionDenied: true, refusal: null, error: null });
    rpc.mockResolvedValueOnce({ data: null, error: { code: "08006", message: "connection" } });
    expect(await correctSubscriptionPlan({ memberId: "m", newPlanId: "p", reason: "Wrong plan" })).toMatchObject({ error: { code: "unknown" }, refusal: null, permissionDenied: false });
  });
});

describe("getCorrectPlanEligibility", () => {
  beforeEach(() => rpc.mockReset());
  const ROW = {
    subscription_id: "s", plan_id: "p", plan_name: "ANNUAL", plan_type: "monthly", billing_interval: "annual", price: 250000, duration_days: 365,
    start_date: "2026-11-02", expiry_date: "2027-11-02", status: "active",
    block_state: null, block_payment_id: null, block_amount: null, block_method: null, block_at: null, block_refunded_amount: null, block_more: null,
  };

  it("maps the subscription, with no block when nothing stands", async () => {
    rpc.mockResolvedValue({ data: [ROW], error: null });
    const { data } = await getCorrectPlanEligibility("m");
    expect(rpc).toHaveBeenCalledWith("correct_plan_eligibility", { p_member_id: "m" });
    expect(data?.block).toBeNull();
    expect(data?.subscription).toMatchObject({ subscriptionId: "s", planName: "ANNUAL", billingInterval: "annual", durationDays: 365, startDate: "2026-11-02" });
  });

  it("maps the most recent standing payment and the count of the others", async () => {
    rpc.mockResolvedValue({ data: [{ ...ROW, block_state: "in_flight", block_amount: 250000, block_method: "mobile_money", block_at: "2026-11-10T09:00:00Z", block_refunded_amount: 0, block_more: 1 }], error: null });
    const { data } = await getCorrectPlanEligibility("m");
    expect(data?.block).toEqual({ state: "in_flight", amount: 250000, method: "mobile_money", createdAt: "2026-11-10T09:00:00Z", on: null, refundedAmount: 0, more: 1 });
  });

  it("an empty answer is no data and no error (F8); a failure is an error", async () => {
    rpc.mockResolvedValueOnce({ data: [], error: null });
    expect(await getCorrectPlanEligibility("m")).toEqual({ data: null, error: null });
    rpc.mockResolvedValueOnce({ data: null, error: { code: "x", message: "boom" } });
    expect((await getCorrectPlanEligibility("m")).error?.code).toBe("unknown");
  });
});
