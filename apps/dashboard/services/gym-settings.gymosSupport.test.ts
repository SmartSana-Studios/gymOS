/**
 * Story 23.3: `setAllowGymosSupport()` and `getGymosSupportStatus()` wrap 0137's RPCs.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

let rpcResult: { data: unknown; error: unknown };
const rpc = vi.fn<(fn: string, args?: unknown) => Promise<typeof rpcResult>>(async () => rpcResult);
let gymRow: { data: unknown; error: unknown } = { data: null, error: null };
const from = vi.fn(() => ({ select: () => ({ eq: () => ({ maybeSingle: async () => gymRow }) }) }));
const getClaims = vi.fn(async () => ({ data: { claims: { gym_id: "gym-1" } }, error: null }));

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => ({ rpc, from, auth: { getClaims } })) }));
vi.mock("@/services/session", () => ({
  mapAndLog: vi.fn(async () => ({ code: "unknown", message: "mapped error" })),
}));
vi.mock("@/lib/i18n/get-request-locale", () => ({ getRequestLocale: vi.fn(async () => "en") }));
vi.mock("@/lib/i18n/get-server-translation", () => ({
  getServerTranslation: vi.fn(async () => ({ t: (key: string) => key })),
}));

import { getAllowGymosSupport, getGymosSupportStatus, setAllowGymosSupport } from "./gym-settings";

describe("setAllowGymosSupport", () => {
  beforeEach(() => rpc.mockClear());

  it("calls set_allow_gymos_support with the caller's gym", async () => {
    rpcResult = { data: null, error: null };
    await expect(setAllowGymosSupport(false)).resolves.toEqual({ data: { ok: true }, error: null });
    expect(rpc.mock.calls[0]).toEqual(["set_allow_gymos_support", { p_gym_id: "gym-1", p_on: false }]);
  });

  it("returns a mapped error without throwing", async () => {
    rpcResult = { data: null, error: { message: "permission denied" } };
    await expect(setAllowGymosSupport(true)).resolves.toEqual({
      data: null,
      error: { code: "unknown", message: "mapped error" },
    });
  });
});

describe("getGymosSupportStatus", () => {
  beforeEach(() => rpc.mockClear());

  it("maps the row", async () => {
    rpcResult = { data: [{ allowed: true, state: "waiting", last_acted_at: null }], error: null };
    await expect(getGymosSupportStatus()).resolves.toEqual({
      data: { allowed: true, state: "waiting", lastActedAt: null },
      error: null,
    });
    expect(rpc.mock.calls[0]).toEqual(["get_gymos_support_status", { p_gym_id: "gym-1" }]);
  });

  it("falls back to off for an unknown state", async () => {
    rpcResult = { data: [{ allowed: false, state: "weird", last_acted_at: "2026-10-21T10:00:00Z" }], error: null };
    const { data } = await getGymosSupportStatus();
    expect(data?.state).toBe("off");
    expect(data?.lastActedAt).toBe("2026-10-21T10:00:00Z");
  });

  it("returns a mapped error", async () => {
    rpcResult = { data: null, error: { message: "permission denied" } };
    await expect(getGymosSupportStatus()).resolves.toEqual({
      data: null,
      error: { code: "unknown", message: "mapped error" },
    });
  });
});

describe("getAllowGymosSupport", () => {
  it.each([
    ["true", { data: { allow_gymos_support: true }, error: null }, true],
    ["false", { data: { allow_gymos_support: false }, error: null }, false],
    ["no row", { data: null, error: null }, false],
    ["query error", { data: null, error: { message: "boom" } }, false],
  ])("returns the right answer for %s", async (_l, row, expected) => {
    gymRow = row;
    await expect(getAllowGymosSupport()).resolves.toBe(expected);
  });
});
