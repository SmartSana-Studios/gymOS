/**
 * Story 18.1: `setRegistrationFee()` is a thin wrapper over the
 * `set_registration_fee()` RPC (0098). The authorization, suspension gate,
 * amount check and audit row live in the RPC and are proven in
 * supabase/tests/registration_fee_foundation*.test.sql; this pins the service
 * contract -- the amount goes through as `p_amount` and nothing else (no gym
 * id, the gym comes from the session), success is `{ ok: true }`, and a
 * failure returns a mapped `{ data: null, error }` rather than throwing.
 * Mocking shape follows gym-settings.getGymLocalPeriodBounds.test.ts.
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

vi.mock("@/lib/i18n/get-request-locale", () => ({
  getRequestLocale: vi.fn(async () => "en"),
}));

vi.mock("@/lib/i18n/get-server-translation", () => ({
  getServerTranslation: vi.fn(async () => ({ t: (key: string) => key })),
}));

import { setRegistrationFee } from "./gym-settings";

describe("setRegistrationFee", () => {
  beforeEach(() => {
    rpc.mockClear();
  });

  it("calls set_registration_fee with only p_amount", async () => {
    rpcResult = { data: null, error: null };

    await setRegistrationFee(5000);

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0]).toEqual(["set_registration_fee", { p_amount: 5000 }]);
  });

  it("returns ok on success", async () => {
    rpcResult = { data: null, error: null };

    await expect(setRegistrationFee(0)).resolves.toEqual({ data: { ok: true }, error: null });
  });

  it("returns a mapped error, without throwing, when the RPC fails", async () => {
    rpcResult = { data: null, error: { message: "permission denied" } };

    await expect(setRegistrationFee(5000)).resolves.toEqual({
      data: null,
      error: { code: "unknown", message: "mapped error" },
    });
  });
});
