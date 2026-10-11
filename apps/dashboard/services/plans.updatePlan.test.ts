/**
 * Story 19.3: updatePlan routes type/price/shape through update_plan_pricing,
 * writes only the name directly (and first), and maps the RPC's refusal codes;
 * listPlans derives hasSubscriptions from the embedded subscriptions(count).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

let order: string[];
let updateArgs: unknown[];
let updateResult: { data: { id: string } | null; error: unknown };
let rpcResult: { data: unknown; error: unknown };
let rpcArgs: { fn: string; args: Record<string, unknown> }[];
let listResult: { data: unknown; error: unknown };

function makeStub() {
  return {
    auth: { getClaims: vi.fn(async () => ({ data: { claims: { gym_id: "gym-1" } }, error: null })) },
    rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
      order.push("rpc");
      rpcArgs.push({ fn, args });
      return rpcResult;
    }),
    from: vi.fn(() => ({
      update: vi.fn((payload: unknown) => {
        order.push("update");
        updateArgs.push(payload);
        const chain: Record<string, unknown> = {};
        chain.eq = () => chain;
        chain.select = () => chain;
        chain.maybeSingle = async () => updateResult;
        return chain;
      }),
      select: vi.fn(() => {
        const chain: Record<string, unknown> = {};
        chain.eq = () => chain;
        chain.order = async () => listResult;
        return chain;
      }),
    })),
  };
}

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => makeStub()) }));
vi.mock("@/services/session", () => ({
  mapAndLog: vi.fn(async (err: unknown) => ({ code: "unknown", message: `mapped: ${JSON.stringify(err)}` })),
}));
vi.mock("@/lib/i18n/get-request-locale", () => ({ getRequestLocale: vi.fn(async () => "en") }));
vi.mock("@/lib/i18n/get-server-translation", () => ({
  getServerTranslation: vi.fn(async () => ({ t: (key: string) => key })),
}));

const INPUT = {
  name: "Gold",
  planType: "monthly" as const,
  price: 15000,
  durationDays: 30,
  billingInterval: "monthly" as const,
  annualDiscountPercent: null,
};

beforeEach(() => {
  order = [];
  updateArgs = [];
  rpcArgs = [];
  updateResult = { data: { id: "plan-1" }, error: null };
  rpcResult = { data: null, error: null };
});

describe("updatePlan", () => {
  it("writes only the name directly, before calling update_plan_pricing with the mapped args", async () => {
    const { updatePlan } = await import("./plans");
    const { error } = await updatePlan("plan-1", INPUT);

    expect(error).toBeNull();
    expect(updateArgs).toEqual([{ name: "Gold" }]);
    expect(order).toEqual(["update", "rpc"]);
    expect(rpcArgs).toEqual([
      {
        fn: "update_plan_pricing",
        args: {
          p_plan_id: "plan-1",
          p_plan_type: "monthly",
          p_price: 15000,
          p_duration_days: 30,
          p_billing_interval: "monthly",
          p_annual_discount_percent: null,
        },
      },
    ]);
  });

  it("does not call the RPC when the name update fails or matches no row", async () => {
    const { updatePlan } = await import("./plans");

    updateResult = { data: null, error: { message: "duplicate" } };
    expect((await updatePlan("plan-1", INPUT)).error?.code).toBe("unknown");

    updateResult = { data: null, error: null };
    expect((await updatePlan("plan-1", INPUT)).error?.code).toBe("not_found");

    expect(rpcArgs).toEqual([]);
  });

  it("maps plan_type_locked to its own code and message", async () => {
    rpcResult = { data: null, error: { message: "plan_type_locked: this plan has subscriptions" } };
    const { updatePlan } = await import("./plans");
    const { error } = await updatePlan("plan-1", INPUT);

    expect(error).toEqual({ code: "plan_type_locked", message: "plans.typeLocked.reason" });
  });

  it("maps plan_not_found to not_found", async () => {
    rpcResult = { data: null, error: { message: "update_plan_pricing: plan_not_found" } };
    const { updatePlan } = await import("./plans");
    const { error } = await updatePlan("plan-1", INPUT);

    expect(error?.code).toBe("not_found");
  });
});

describe("listPlans hasSubscriptions", () => {
  it("derives it from the embedded subscriptions(count)", async () => {
    const base = {
      name: "P",
      plan_type: "monthly",
      price: 1,
      currency: "XAF",
      duration_days: 30,
      billing_interval: "monthly",
      annual_discount_percent: null,
    };
    listResult = {
      data: [
        { ...base, id: "a", subscriptions: [{ count: 2 }] },
        { ...base, id: "b", subscriptions: [{ count: 0 }] },
        { ...base, id: "c", subscriptions: null },
      ],
      error: null,
    };
    const { listPlans } = await import("./plans");
    const { data } = await listPlans();

    expect(data?.map((p) => p.hasSubscriptions)).toEqual([true, false, false]);
  });
});
