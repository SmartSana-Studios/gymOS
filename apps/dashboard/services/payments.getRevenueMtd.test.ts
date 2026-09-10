/**
 * Story 17.1 (Task 3, AC #4/#11): `getRevenueMtd()` is a thin wrapper over
 * the `gym_revenue_mtd()` aggregate (0095). The figure itself is proven in
 * supabase/tests/gym_revenue_mtd.test.sql; this pins the service contract
 * the Overview page branches on -- the RPC is called with NO arguments (the
 * gym is resolved server-side from `private.gym_id()`), a success returns the
 * number as-is (negative included, never clamped), and a failure returns a
 * mapped `{ data: null, error }` rather than throwing, so the page can
 * degrade the revenue card alone. Mocking shape follows
 * payments.initiatePayment.test.ts.
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

import { getRevenueMtd } from "./payments";

describe("getRevenueMtd", () => {
  beforeEach(() => {
    rpc.mockClear();
  });

  it("calls gym_revenue_mtd with no arguments -- the gym is never passed from the client", async () => {
    rpcResult = { data: 7500, error: null };

    await getRevenueMtd();

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0]).toEqual(["gym_revenue_mtd"]);
  });

  it("returns the aggregate's figure on success", async () => {
    rpcResult = { data: 7500, error: null };

    await expect(getRevenueMtd()).resolves.toEqual({ data: 7500, error: null });
  });

  it("returns a negative figure as-is rather than clamping it to 0", async () => {
    rpcResult = { data: -1500, error: null };

    await expect(getRevenueMtd()).resolves.toEqual({ data: -1500, error: null });
  });

  it("returns a mapped error with null data instead of throwing", async () => {
    rpcResult = { data: null, error: { message: "boom" } };

    await expect(getRevenueMtd()).resolves.toEqual({
      data: null,
      error: { code: "unknown", message: "mapped error" },
    });
  });
});
