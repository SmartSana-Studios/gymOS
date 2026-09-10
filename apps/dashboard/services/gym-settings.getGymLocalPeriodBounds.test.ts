/**
 * Story 17.2 (Task 3, AC #10): `getGymLocalPeriodBounds()` is a thin wrapper
 * over the `gym_local_period_bounds()` RPC (0097). The bounds themselves are
 * proven in supabase/tests/gym_local_period_bounds.test.sql; this pins the
 * service contract the gym-health row branches on -- the RPC is called with
 * NO arguments (the gym is resolved server-side from `private.gym_id()`), the
 * first row is mapped snake -> camel, zero rows is `not_found` rather than an
 * invented window, and a failure returns a mapped `{ data: null, error }`
 * rather than throwing. Mocking shape follows payments.getRevenueMtd.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type BoundsRow = {
  month_start_date: string;
  next_month_start_date: string;
  day_start: string;
  next_day_start: string;
};

let rpcResult: { data: BoundsRow[] | null; error: unknown };
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

import { getGymLocalPeriodBounds } from "./gym-settings";

const ROW: BoundsRow = {
  month_start_date: "2026-09-01",
  next_month_start_date: "2026-10-01",
  day_start: "2026-09-09T23:00:00+00:00",
  next_day_start: "2026-09-10T23:00:00+00:00",
};

describe("getGymLocalPeriodBounds", () => {
  beforeEach(() => {
    rpc.mockClear();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("calls gym_local_period_bounds with no arguments -- the gym is never passed from the client", async () => {
    rpcResult = { data: [ROW], error: null };

    await getGymLocalPeriodBounds();

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0]).toEqual(["gym_local_period_bounds"]);
  });

  it("maps the row to camelCase bounds", async () => {
    rpcResult = { data: [ROW], error: null };

    await expect(getGymLocalPeriodBounds()).resolves.toEqual({
      data: {
        monthStartDate: "2026-09-01",
        nextMonthStartDate: "2026-10-01",
        dayStart: "2026-09-09T23:00:00+00:00",
        nextDayStart: "2026-09-10T23:00:00+00:00",
      },
      error: null,
    });
  });

  it("returns not_found for zero rows (no gym_id claim, or no visible gym) instead of inventing a window", async () => {
    rpcResult = { data: [], error: null };

    await expect(getGymLocalPeriodBounds()).resolves.toEqual({
      data: null,
      error: { code: "not_found", message: "settings.errors.gymNotFound" },
    });
  });

  it("treats a null result like zero rows", async () => {
    rpcResult = { data: null, error: null };

    const result = await getGymLocalPeriodBounds();

    expect(result.data).toBeNull();
    expect(result.error).toMatchObject({ code: "not_found" });
  });

  it("returns a mapped error with null data instead of throwing", async () => {
    rpcResult = { data: null, error: { message: "boom" } };

    await expect(getGymLocalPeriodBounds()).resolves.toEqual({
      data: null,
      error: { code: "unknown", message: "mapped error" },
    });
  });
});
