/**
 * Story 28.1: `setSessionValidity()` / `getSessionValiditySettings()` are thin wrappers over the 0177 RPCs; authorization lives in the RPCs.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

let rpcResult: { data: unknown; error: unknown };
const rpc = vi.fn<(fn: string, args?: unknown) => Promise<typeof rpcResult>>(async () => rpcResult);

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    rpc,
    auth: { getClaims: async () => ({ data: { claims: { gym_id: "gym-1" } }, error: null }) },
  })),
}));

vi.mock("@/services/session", () => ({
  mapAndLog: vi.fn(async () => ({ code: "unknown", message: "mapped error" })),
}));

vi.mock("@/lib/i18n/get-request-locale", () => ({ getRequestLocale: vi.fn(async () => "en") }));
vi.mock("@/lib/i18n/get-server-translation", () => ({
  getServerTranslation: vi.fn(async () => ({ t: (key: string) => key })),
}));

import { getSessionValiditySettings, setSessionValidity } from "./gym-settings";

describe("setSessionValidity", () => {
  beforeEach(() => rpc.mockClear());

  it("calls set_session_validity with the caller's gym and the code", async () => {
    rpcResult = { data: null, error: null };
    await expect(setSessionValidity("single_use")).resolves.toEqual({ data: { ok: true }, error: null });
    expect(rpc.mock.calls[0]).toEqual(["set_session_validity", { p_gym_id: "gym-1", p_validity: "single_use" }]);
  });

  it("returns a mapped error without throwing", async () => {
    rpcResult = { data: null, error: { message: "permission denied" } };
    await expect(setSessionValidity("whole_day")).resolves.toEqual({
      data: null,
      error: { code: "unknown", message: "mapped error" },
    });
  });
});

describe("getSessionValiditySettings", () => {
  beforeEach(() => rpc.mockClear());

  it("maps the one row", async () => {
    rpcResult = { data: [{ session_validity: "single_use", single_use_visit_limit_minutes: 90 }], error: null };
    await expect(getSessionValiditySettings()).resolves.toEqual({
      data: { sessionValidity: "single_use", visitLimitMinutes: 90 },
      error: null,
    });
    expect(rpc.mock.calls[0]).toEqual(["get_session_validity_settings"]);
  });

  it("returns no data and no error when the function returns nothing (a role that may not read it)", async () => {
    rpcResult = { data: [], error: null };
    await expect(getSessionValiditySettings()).resolves.toEqual({ data: null, error: null });
  });

  it("returns a mapped error on failure", async () => {
    rpcResult = { data: null, error: { message: "boom" } };
    await expect(getSessionValiditySettings()).resolves.toEqual({
      data: null,
      error: { code: "unknown", message: "mapped error" },
    });
  });
});
