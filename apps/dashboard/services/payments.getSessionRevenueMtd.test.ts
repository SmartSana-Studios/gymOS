/**
 * Story 19.8: `getSessionRevenueMtd()` is a thin wrapper over the
 * `gym_session_revenue_mtd()` aggregate (0113). The figure is proven in
 * supabase/tests/session_refund*.test.sql; this pins the service contract the
 * Overview branches on -- no arguments, the number as-is, and a mapped error
 * instead of a throw so the page can hide the line alone.
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

import { getSessionRevenueMtd } from "./payments";

describe("getSessionRevenueMtd", () => {
  beforeEach(() => {
    rpc.mockClear();
  });

  it("calls gym_session_revenue_mtd with no arguments -- the gym is never passed from the client", async () => {
    rpcResult = { data: 3000, error: null };

    await getSessionRevenueMtd();

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0]).toEqual(["gym_session_revenue_mtd"]);
  });

  it("returns the aggregate's figure on success", async () => {
    rpcResult = { data: 3000, error: null };

    await expect(getSessionRevenueMtd()).resolves.toEqual({ data: 3000, error: null });
  });

  it("returns 0 for a null result rather than null", async () => {
    rpcResult = { data: null, error: null };

    await expect(getSessionRevenueMtd()).resolves.toEqual({ data: 0, error: null });
  });

  it("returns a mapped error with null data instead of throwing", async () => {
    rpcResult = { data: null, error: { message: "boom" } };

    await expect(getSessionRevenueMtd()).resolves.toEqual({
      data: null,
      error: { code: "unknown", message: "mapped error" },
    });
  });
});
