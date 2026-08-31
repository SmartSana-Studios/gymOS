/**
 * Story 11.7 (Task 6): unit tests for billing.ts's new/extended functions --
 * `listSelectableTiers()`, `initiateSaasBillingPayment()`'s tier/interval
 * override params, and `createSaasBillingHostedCheckoutLink()`. Mocks
 * `@/lib/supabase/server`'s `createClient()` with a chainable stub, matching
 * `payments.initiatePayment.test.ts`'s established convention for this same
 * boundary.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

let claimsResult: { data: { claims: Record<string, unknown> | null } | null; error: unknown };
let providerKeyResult: { data: string | null; error: unknown };
let rpcCalls: { fn: string; args?: Record<string, unknown> }[];
let initiateRpcResult: { data: string | null; error: unknown };
let listTiersRpcResult: { data: unknown; error: unknown };
let invokeResult: { data: unknown; error: unknown };
let invokeCalls: { path: string; body: unknown }[];

function makeSupabaseStub() {
  return {
    auth: {
      getClaims: vi.fn(async () => claimsResult),
    },
    rpc: vi.fn(async (fn: string, args?: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      if (fn === "active_payment_provider") return providerKeyResult;
      if (fn === "initiate_saas_billing_payment") return initiateRpcResult;
      if (fn === "list_selectable_saas_billing_tiers") return listTiersRpcResult;
      throw new Error(`unmocked rpc: ${fn}`);
    }),
    functions: {
      invoke: vi.fn(async (path: string, opts: { body: unknown }) => {
        invokeCalls.push({ path, body: opts.body });
        return invokeResult;
      }),
    },
  };
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => makeSupabaseStub()),
}));

vi.mock("@/services/session", () => ({
  mapAndLog: vi.fn(async (err: unknown) => ({ code: "unknown", message: `mapped: ${JSON.stringify(err)}` })),
}));

vi.mock("@/lib/i18n/get-request-locale", () => ({
  getRequestLocale: vi.fn(async () => "en"),
}));

vi.mock("@/lib/i18n/get-server-translation", () => ({
  getServerTranslation: vi.fn(async () => ({ t: (key: string) => key })),
}));

beforeEach(() => {
  claimsResult = { data: { claims: { gym_id: "gym-1" } }, error: null };
  providerKeyResult = { data: "taramoney", error: null };
  rpcCalls = [];
  initiateRpcResult = { data: "payment-1", error: null };
  listTiersRpcResult = {
    data: [
      { id: "tier-a", name: "Starter", monthly_price: 8000, annual_price: 80000 },
      { id: "tier-b", name: "Growth", monthly_price: 20000, annual_price: 200000 },
    ],
    error: null,
  };
  invokeResult = { data: { checkoutUrl: "https://pay.taramoney.com/link/xyz" }, error: null };
  invokeCalls = [];
});

describe("listSelectableTiers", () => {
  it("maps snake_case RPC rows to camelCase SelectableTier objects", async () => {
    const { listSelectableTiers } = await import("./billing");
    const result = await listSelectableTiers();
    expect(result).toEqual({
      data: [
        { id: "tier-a", name: "Starter", monthlyPrice: 8000, annualPrice: 80000 },
        { id: "tier-b", name: "Growth", monthlyPrice: 20000, annualPrice: 200000 },
      ],
      error: null,
    });
  });

  it("returns an empty array (not null) when the RPC returns null data", async () => {
    listTiersRpcResult = { data: null, error: null };
    const { listSelectableTiers } = await import("./billing");
    const result = await listSelectableTiers();
    expect(result).toEqual({ data: [], error: null });
  });

  it("maps an RPC error via mapAndLog", async () => {
    listTiersRpcResult = { data: null, error: { message: "db error" } };
    const { listSelectableTiers } = await import("./billing");
    const result = await listSelectableTiers();
    expect(result.data).toBeNull();
    expect(result.error?.code).toBe("unknown");
  });
});

describe("initiateSaasBillingPayment: tier/interval override", () => {
  it("passes tierId/interval through to the RPC as p_tier_id/p_interval when provided", async () => {
    const { initiateSaasBillingPayment } = await import("./billing");
    await initiateSaasBillingPayment("+237600000000", "tier-b", "annual");

    const initiateCall = rpcCalls.find((c) => c.fn === "initiate_saas_billing_payment");
    expect(initiateCall?.args).toEqual({ p_tier_id: "tier-b", p_interval: "annual" });
  });

  it("passes null for both params when neither override is provided (backward compatible)", async () => {
    const { initiateSaasBillingPayment } = await import("./billing");
    await initiateSaasBillingPayment("+237600000000");

    const initiateCall = rpcCalls.find((c) => c.fn === "initiate_saas_billing_payment");
    expect(initiateCall?.args).toEqual({ p_tier_id: null, p_interval: null });
  });
});

describe("createSaasBillingHostedCheckoutLink", () => {
  it("creates a processing row via initiate_saas_billing_payment, then invokes the initiate-link route and returns the checkoutUrl", async () => {
    const { createSaasBillingHostedCheckoutLink } = await import("./billing");
    const result = await createSaasBillingHostedCheckoutLink("tier-b", "annual");

    expect(result).toEqual({ data: { paymentId: "payment-1", checkoutUrl: "https://pay.taramoney.com/link/xyz" }, error: null });
    expect(invokeCalls).toEqual([{ path: "payment-webhook/initiate-link/taramoney", body: { paymentId: "payment-1" } }]);
  });

  it("never sends a phoneNumber -- the invoke body carries only paymentId", async () => {
    const { createSaasBillingHostedCheckoutLink } = await import("./billing");
    await createSaasBillingHostedCheckoutLink();

    expect(Object.keys(invokeCalls[0].body as object)).toEqual(["paymentId"]);
  });

  it("an RPC failure returns the mapped error without ever invoking the Edge Function", async () => {
    initiateRpcResult = { data: null, error: { message: "payment_already_pending" } };
    const { createSaasBillingHostedCheckoutLink } = await import("./billing");
    const result = await createSaasBillingHostedCheckoutLink();

    expect(result.data).toBeNull();
    expect(invokeCalls).toEqual([]);
  });

  it("an invoke failure (no checkoutUrl) maps to an error via mapAndLog", async () => {
    invokeResult = { data: null, error: new Error("edge function failed") };
    const { createSaasBillingHostedCheckoutLink } = await import("./billing");
    const result = await createSaasBillingHostedCheckoutLink();

    expect(result.data).toBeNull();
    expect(result.error?.code).toBe("unknown");
  });
});
