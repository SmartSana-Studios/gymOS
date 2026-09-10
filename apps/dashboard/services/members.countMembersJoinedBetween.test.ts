/**
 * Story 17.2 (Task 3, AC #3, #7): `countMembersJoinedBetween()` backs the
 * gym-health row's "New this month" card.
 *
 * Pinned here: a head COUNT, never a row fetch; scoped to the caller's gym;
 * `role = 'member'` (gym_staff_read_own_members also returns staff rows, so
 * without it every staff join counts); and a half-open `join_date` range
 * compared as the gym-local YYYY-MM-DD strings the caller passes -- `join_date`
 * is a `date`, so no timestamps are involved. Deactivated members are NOT
 * excluded: the card counts joins, not current headcount. The query builder
 * is a recording stub: every call is appended to `calls`, and awaiting the
 * builder resolves to `result`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Call = [string, ...unknown[]];

let calls: Call[];
let result: { count: number | null; error: unknown };
let claimsResult: { data: { claims: Record<string, unknown> | null } | null; error: unknown };

function makeBuilder() {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "is", "in", "gte", "lt"]) {
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

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getClaims: vi.fn(async () => claimsResult) },
    from,
  })),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
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

import { countMembersJoinedBetween } from "./members";

describe("countMembersJoinedBetween", () => {
  beforeEach(() => {
    calls = [];
    result = { count: 3, error: null };
    claimsResult = { data: { claims: { gym_id: "gym-1" } }, error: null };
    from.mockClear();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("head-counts role=member rows whose join_date falls in [start, end), gym-scoped", async () => {
    await expect(countMembersJoinedBetween("2026-09-01", "2026-10-01")).resolves.toEqual({ data: 3, error: null });

    expect(calls).toEqual([
      ["from", "members"],
      ["select", "id", { count: "exact", head: true }],
      ["eq", "gym_id", "gym-1"],
      ["eq", "role", "member"],
      ["gte", "join_date", "2026-09-01"],
      ["lt", "join_date", "2026-10-01"],
    ]);
  });

  it("does not exclude deactivated members -- the card counts joins, not headcount", async () => {
    await countMembersJoinedBetween("2026-09-01", "2026-10-01");

    expect(calls.some(([method, column]) => column === "deactivated_at" || method === "is")).toBe(false);
  });

  it("returns 0 when the count comes back null on success", async () => {
    result = { count: null, error: null };

    await expect(countMembersJoinedBetween("2026-09-01", "2026-10-01")).resolves.toEqual({ data: 0, error: null });
  });

  it("returns a mapped error with null data instead of throwing", async () => {
    result = { count: null, error: { message: "boom" } };

    await expect(countMembersJoinedBetween("2026-09-01", "2026-10-01")).resolves.toEqual({
      data: null,
      error: { code: "unknown", message: "mapped error" },
    });
  });

  it("returns the claims error and never queries when there is no gym_id claim", async () => {
    claimsResult = { data: { claims: {} }, error: null };

    const outcome = await countMembersJoinedBetween("2026-09-01", "2026-10-01");

    expect(outcome.data).toBeNull();
    expect(outcome.error).toMatchObject({ code: "not_found" });
    expect(from).not.toHaveBeenCalled();
  });
});
