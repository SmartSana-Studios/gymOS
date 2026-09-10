/**
 * Story 17.2 (Task 3, AC #3, #4, #5, #6): `countSubscriptions()` backs the
 * gym-health row's "Active members" and "At risk" cards, and the named status
 * groups it counts by are the same ones `/subscriptions?status=` now accepts.
 *
 * Pinned here: the count is a head COUNT (`count: "exact", head: true`), never
 * a row fetch; it reads `subscriptions_current` scoped to the caller's gym
 * with deactivated members excluded (the view does not exclude them itself);
 * a group key filters with `.in`, a single status still with `.eq`, and an
 * unknown value with neither -- in `listSubscriptions()` too, which shares
 * `applySubscriptionFilters` with the count, so a card and its target page
 * share one predicate. The query builder is a recording stub: every call is
 * appended to `calls`, and awaiting the builder resolves to `result`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Call = [string, ...unknown[]];

let calls: Call[];
let result: { data?: unknown; count: number | null; error: unknown };
let claimsResult: { data: { claims: Record<string, unknown> | null } | null; error: unknown };

function makeBuilder() {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "is", "in", "gte", "lt", "order", "range"]) {
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

import { countSubscriptions, listSubscriptions } from "./subscriptions";

const COUNT_BASE: Call[] = [
  ["from", "subscriptions_current"],
  ["select", "subscription_id", { count: "exact", head: true }],
  ["eq", "gym_id", "gym-1"],
  ["is", "deactivated_at", null],
];

function statusFilterCalls(): Call[] {
  return calls.filter(([method, column]) => (method === "eq" || method === "in") && column === "status");
}

describe("countSubscriptions", () => {
  beforeEach(() => {
    calls = [];
    result = { count: 7, error: null };
    claimsResult = { data: { claims: { gym_id: "gym-1" } }, error: null };
    from.mockClear();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("counts active_or_expiring as a head count over active + expiring_soon, gym-scoped, deactivated excluded", async () => {
    await expect(countSubscriptions({ status: "active_or_expiring" })).resolves.toEqual({ data: 7, error: null });

    expect(calls).toEqual([...COUNT_BASE, ["in", "status", ["active", "expiring_soon"]]]);
  });

  it("counts at_risk over grace_period + expired", async () => {
    await countSubscriptions({ status: "at_risk" });

    expect(calls).toEqual([...COUNT_BASE, ["in", "status", ["grace_period", "expired"]]]);
  });

  it("still filters a single real status with .eq", async () => {
    await countSubscriptions({ status: "grace_period" });

    expect(calls).toEqual([...COUNT_BASE, ["eq", "status", "grace_period"]]);
  });

  it("returns 0 when the count comes back null on success", async () => {
    result = { count: null, error: null };

    await expect(countSubscriptions({ status: "at_risk" })).resolves.toEqual({ data: 0, error: null });
  });

  it("returns a mapped error with null data instead of throwing", async () => {
    result = { count: null, error: { message: "boom" } };

    await expect(countSubscriptions({ status: "at_risk" })).resolves.toEqual({
      data: null,
      error: { code: "unknown", message: "mapped error" },
    });
  });

  it("returns the claims error and never queries when there is no gym_id claim", async () => {
    claimsResult = { data: { claims: {} }, error: null };

    const outcome = await countSubscriptions({ status: "at_risk" });

    expect(outcome.data).toBeNull();
    expect(outcome.error).toMatchObject({ code: "not_found" });
    expect(from).not.toHaveBeenCalled();
  });
});

describe("listSubscriptions with the named status groups", () => {
  beforeEach(() => {
    calls = [];
    result = { data: [], count: 0, error: null };
    claimsResult = { data: { claims: { gym_id: "gym-1" } }, error: null };
  });

  it("filters ?status=at_risk with .in", async () => {
    await listSubscriptions({ status: "at_risk" });

    expect(statusFilterCalls()).toEqual([["in", "status", ["grace_period", "expired"]]]);
  });

  it("filters ?status=active_or_expiring with .in", async () => {
    await listSubscriptions({ status: "active_or_expiring" });

    expect(statusFilterCalls()).toEqual([["in", "status", ["active", "expiring_soon"]]]);
  });

  it("keeps a single status on .eq, unchanged", async () => {
    await listSubscriptions({ status: "grace_period" });

    expect(statusFilterCalls()).toEqual([["eq", "status", "grace_period"]]);
  });

  it("still ignores an unrecognised status, as before", async () => {
    await listSubscriptions({ status: "bogus" });

    expect(statusFilterCalls()).toEqual([]);
  });
});
