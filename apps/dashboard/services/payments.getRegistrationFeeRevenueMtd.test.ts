/**
 * Story 18.4: `getRegistrationFeeRevenueMtd()` is a thin wrapper over the
 * `gym_registration_fee_revenue_mtd()` aggregate (0101). The figure itself is
 * proven in supabase/tests/registration_fee_void_refund_revenue.test.sql; this
 * pins the service contract the Overview page branches on -- the RPC is called
 * with NO arguments (the gym is resolved server-side), a success returns the
 * number as-is, and a failure returns a mapped `{ data: null, error }` rather
 * than throwing, so the page can hide the fee line alone. Mirrors
 * payments.getRevenueMtd.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

let rpcResult: { data: number | null; error: unknown };
const rpc = vi.fn<(fn: string, args?: unknown) => Promise<typeof rpcResult>>(async () => rpcResult);

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ rpc })),
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

import { getRegistrationFeeRevenueMtd } from "./payments";

describe("getRegistrationFeeRevenueMtd", () => {
  beforeEach(() => {
    rpc.mockClear();
  });

  it("calls gym_registration_fee_revenue_mtd with no arguments -- the gym is never passed from the client", async () => {
    rpcResult = { data: 15000, error: null };

    await getRegistrationFeeRevenueMtd();

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0]).toEqual(["gym_registration_fee_revenue_mtd"]);
  });

  it("returns the aggregate's figure on success", async () => {
    rpcResult = { data: 15000, error: null };

    await expect(getRegistrationFeeRevenueMtd()).resolves.toEqual({ data: 15000, error: null });
  });

  it("returns 0 for a null result rather than null", async () => {
    rpcResult = { data: null, error: null };

    await expect(getRegistrationFeeRevenueMtd()).resolves.toEqual({ data: 0, error: null });
  });

  it("returns a mapped error with null data instead of throwing", async () => {
    rpcResult = { data: null, error: { message: "boom" } };

    await expect(getRegistrationFeeRevenueMtd()).resolves.toEqual({
      data: null,
      error: { code: "unknown", message: "mapped error" },
    });
  });
});
