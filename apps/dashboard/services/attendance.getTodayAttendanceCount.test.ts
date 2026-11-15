/**
 * Story 27.1: the Attendance page's "today" count reads `attendance_counted` (never the base table, so a voided
 * visit is not counted) over the GYM-LOCAL day from `gym_local_period_bounds()` (0097), no longer the UTC day.
 *
 * Pinned: with the clock at 23:30 UTC and the gym in Africa/Douala (UTC+1, so 00:30 on the next local day), a
 * check-in at 23:10 UTC (00:10 local) lies inside the half-open window the query uses, and the window is not the
 * UTC calendar day. The query builder is a recording stub; awaiting it resolves to `result`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Call = [string, ...unknown[]];

let calls: Call[];
let result: { count: number | null; error: unknown };
let boundsResult: { data: unknown[] | null; error: unknown };
let claimsResult: { data: { claims: Record<string, unknown> | null } | null; error: unknown };

function makeBuilder() {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "is", "gte", "lt"]) {
    builder[method] = (...args: unknown[]) => {
      calls.push([method, ...args]);
      return builder;
    };
  }
  builder.then = (resolve: (value: typeof result) => unknown, reject: (reason: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return builder;
}

const from = vi.fn((table: string) => {
  calls.push(["from", table]);
  return makeBuilder();
});
const rpc = vi.fn(async () => boundsResult);

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getClaims: vi.fn(async () => claimsResult) },
    from,
    rpc,
  })),
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

import { getTodayAttendanceCount } from "./attendance";

const GYM_ID = "00000000-0000-0000-0000-000000000a01";
// Douala is UTC+1: the local day of 8 Nov starts at 23:00 UTC on 7 Nov.
const DOUALA_BOUNDS = {
  month_start_date: "2026-11-01",
  next_month_start_date: "2026-12-01",
  day_start: "2026-11-07T23:00:00+00:00",
  next_day_start: "2026-11-08T23:00:00+00:00",
};

function arg(method: string, column: string): string {
  const call = calls.find((c) => c[0] === method && c[1] === column);
  if (!call) throw new Error(`no ${method}(${column}) call`);
  return call[2] as string;
}

describe("getTodayAttendanceCount (27.1)", () => {
  beforeEach(() => {
    calls = [];
    result = { count: 4, error: null };
    boundsResult = { data: [DOUALA_BOUNDS], error: null };
    claimsResult = { data: { claims: { gym_id: GYM_ID } }, error: null };
    from.mockClear();
    rpc.mockClear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-07T23:30:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reads attendance_counted, never the base table", async () => {
    await getTodayAttendanceCount();
    expect(calls.filter((c) => c[0] === "from")).toEqual([["from", "attendance_counted"]]);
  });

  it("counts a 00:10 local check-in (23:10 UTC) for today when the clock is 23:30 UTC in Douala", async () => {
    const { count, error } = await getTodayAttendanceCount();
    expect(error).toBeNull();
    expect(count).toBe(4);

    const gte = arg("gte", "checked_in_at");
    const lt = arg("lt", "checked_in_at");
    const checkIn = new Date("2026-11-07T23:10:00Z").getTime();
    expect(checkIn >= new Date(gte).getTime() && checkIn < new Date(lt).getTime()).toBe(true);

    // The old UTC-day window [2026-11-07T00:00Z, 2026-11-08T00:00Z) is not what the query uses.
    expect(new Date(gte).toISOString()).toBe("2026-11-07T23:00:00.000Z");
    expect(new Date(lt).toISOString()).toBe("2026-11-08T23:00:00.000Z");
  });

  it("scopes the count to the caller's gym", async () => {
    await getTodayAttendanceCount();
    expect(calls).toContainEqual(["eq", "gym_id", GYM_ID]);
  });

  it("asks the database for the bounds with no arguments (the gym is resolved server-side)", async () => {
    await getTodayAttendanceCount();
    expect(rpc).toHaveBeenCalledWith("gym_local_period_bounds");
  });

  it("returns a mapped error and count 0 when the bounds cannot be read, without querying attendance", async () => {
    boundsResult = { data: null, error: { message: "boom" } };
    const out = await getTodayAttendanceCount();
    expect(out.count).toBe(0);
    expect(out.error).toEqual({ code: "unknown", message: "mapped error" });
    expect(from).not.toHaveBeenCalled();
  });

  it("returns a mapped error when the count query fails", async () => {
    result = { count: null, error: { message: "boom" } };
    const out = await getTodayAttendanceCount();
    expect(out.count).toBe(0);
    expect(out.error).toEqual({ code: "unknown", message: "mapped error" });
  });
});
