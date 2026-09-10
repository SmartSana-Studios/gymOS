/**
 * Story 17.2 (Task 3, AC #3, #8): `countClassSessionsBetween()` backs the
 * gym-health row's "Today's classes" card.
 *
 * Pinned here: a head COUNT, never a row fetch (unlike `listClasses()`, which
 * fetches rows and counts in JS); scoped to the caller's gym; and a half-open
 * `scheduled_at` range over the UTC instants the caller passes -- the
 * gym-local day bounds from `gym_local_period_bounds()`. No cancellation
 * filter exists to apply: `class_sessions` has no such column. The query
 * builder is a recording stub: every call is appended to `calls`, and
 * awaiting the builder resolves to `result`.
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

vi.mock("@/services/session", () => ({
  mapAndLog: vi.fn(async () => ({ code: "unknown", message: "mapped error" })),
}));

vi.mock("@/lib/i18n/get-request-locale", () => ({
  getRequestLocale: vi.fn(async () => "en"),
}));

vi.mock("@/lib/i18n/get-server-translation", () => ({
  getServerTranslation: vi.fn(async () => ({ t: (key: string) => key })),
}));

import { countClassSessionsBetween } from "./classes";

const DAY_START = "2026-09-09T23:00:00+00:00";
const NEXT_DAY_START = "2026-09-10T23:00:00+00:00";

describe("countClassSessionsBetween", () => {
  beforeEach(() => {
    calls = [];
    result = { count: 2, error: null };
    claimsResult = { data: { claims: { gym_id: "gym-1" } }, error: null };
    from.mockClear();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("head-counts class_sessions whose scheduled_at falls in [start, end), gym-scoped", async () => {
    await expect(countClassSessionsBetween(DAY_START, NEXT_DAY_START)).resolves.toEqual({ data: 2, error: null });

    expect(calls).toEqual([
      ["from", "class_sessions"],
      ["select", "id", { count: "exact", head: true }],
      ["eq", "gym_id", "gym-1"],
      ["gte", "scheduled_at", DAY_START],
      ["lt", "scheduled_at", NEXT_DAY_START],
    ]);
  });

  it("returns 0 when the count comes back null on success", async () => {
    result = { count: null, error: null };

    await expect(countClassSessionsBetween(DAY_START, NEXT_DAY_START)).resolves.toEqual({ data: 0, error: null });
  });

  it("returns a mapped error with null data instead of throwing", async () => {
    result = { count: null, error: { message: "boom" } };

    await expect(countClassSessionsBetween(DAY_START, NEXT_DAY_START)).resolves.toEqual({
      data: null,
      error: { code: "unknown", message: "mapped error" },
    });
  });

  it("returns the claims error and never queries when there is no gym_id claim", async () => {
    claimsResult = { data: { claims: {} }, error: null };

    const outcome = await countClassSessionsBetween(DAY_START, NEXT_DAY_START);

    expect(outcome.data).toBeNull();
    expect(outcome.error).toMatchObject({ code: "not_found" });
    expect(from).not.toHaveBeenCalled();
  });
});
