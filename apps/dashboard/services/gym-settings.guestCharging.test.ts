/**
 * Story 19.9a: `getGuestChargingImpact()` / `setGuestCharging()` are thin
 * wrappers over the 0107 RPCs; authorization lives in the RPCs.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

let rpcResult: { data: unknown; error: unknown };
const rpc = vi.fn<(fn: string, args?: unknown) => Promise<typeof rpcResult>>(async () => rpcResult);

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ rpc })),
}));

vi.mock("@/services/session", () => ({
  mapAndLog: vi.fn(async () => ({ code: "unknown", message: "mapped error" })),
}));

vi.mock("@/lib/i18n/get-request-locale", () => ({ getRequestLocale: vi.fn(async () => "en") }));
vi.mock("@/lib/i18n/get-server-translation", () => ({
  getServerTranslation: vi.fn(async () => ({ t: (key: string) => key })),
}));

import { getGuestChargingImpact, setGuestCharging } from "./gym-settings";

describe("setGuestCharging", () => {
  beforeEach(() => rpc.mockClear());

  it("calls set_guest_charging with only p_enabled", async () => {
    rpcResult = { data: null, error: null };
    await expect(setGuestCharging(true)).resolves.toEqual({ data: { ok: true }, error: null });
    expect(rpc.mock.calls[0]).toEqual(["set_guest_charging", { p_enabled: true }]);
  });

  it("returns a mapped error without throwing", async () => {
    rpcResult = { data: null, error: { message: "permission denied" } };
    await expect(setGuestCharging(false)).resolves.toEqual({
      data: null,
      error: { code: "unknown", message: "mapped error" },
    });
  });
});

describe("getGuestChargingImpact", () => {
  beforeEach(() => rpc.mockClear());

  it("returns the RPC count", async () => {
    rpcResult = { data: 9, error: null };
    await expect(getGuestChargingImpact()).resolves.toEqual({ data: 9, error: null });
    expect(rpc.mock.calls[0]).toEqual(["guest_charging_impact"]);
  });

  it("returns a mapped error on failure", async () => {
    rpcResult = { data: null, error: { message: "permission denied" } };
    await expect(getGuestChargingImpact()).resolves.toEqual({
      data: null,
      error: { code: "unknown", message: "mapped error" },
    });
  });
});
