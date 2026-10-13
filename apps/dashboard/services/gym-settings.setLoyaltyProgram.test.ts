/**
 * Story 20.5: `setLoyaltyProgram()` is a thin wrapper over `set_loyalty_program` (0117).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

let rpcResult: { data: unknown; error: unknown };
const rpc = vi.fn<(fn: string, args?: unknown) => Promise<typeof rpcResult>>(async () => rpcResult);

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => ({ rpc })) }));
vi.mock("@/services/session", () => ({
  mapAndLog: vi.fn(async () => ({ code: "unknown", message: "mapped error" })),
}));
vi.mock("@/lib/i18n/get-request-locale", () => ({ getRequestLocale: vi.fn(async () => "en") }));
vi.mock("@/lib/i18n/get-server-translation", () => ({
  getServerTranslation: vi.fn(async () => ({ t: (key: string) => key })),
}));

import { setLoyaltyProgram } from "./gym-settings";

describe("setLoyaltyProgram", () => {
  beforeEach(() => rpc.mockClear());

  it("calls set_loyalty_program with all four arguments", async () => {
    rpcResult = { data: null, error: null };
    await expect(setLoyaltyProgram({ enabled: true, n: 5, k: 3, r: 30 })).resolves.toEqual({
      data: { ok: true },
      error: null,
    });
    expect(rpc.mock.calls[0]).toEqual(["set_loyalty_program", { p_enabled: true, p_n: 5, p_k: 3, p_r: 30 }]);
  });

  it("returns a mapped error without throwing", async () => {
    rpcResult = { data: null, error: { message: "permission denied" } };
    await expect(setLoyaltyProgram({ enabled: false, n: 2, k: 3, r: 1 })).resolves.toEqual({
      data: null,
      error: { code: "unknown", message: "mapped error" },
    });
  });
});
