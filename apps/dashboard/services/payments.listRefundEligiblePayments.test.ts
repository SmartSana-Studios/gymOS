/**
 * Story 18.4: the Record Refund modal's payment picker never offers a
 * registration fee payment or a voided one. The refunds insert policy and
 * trigger (0101) are the real gate; this pins that the picker query asks for
 * subscription payments with `voided_at is null`, and still drops a payment
 * that already has a refund.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: Array<[string, ...unknown[]]> = [];
let rows: unknown[];

function makeBuilder() {
  const builder: Record<string, unknown> = {};
  for (const name of ["select", "eq", "is"]) {
    builder[name] = vi.fn((...args: unknown[]) => {
      calls.push([name, ...args]);
      return builder;
    });
  }
  builder.order = vi.fn(async (...args: unknown[]) => {
    calls.push(["order", ...args]);
    return { data: rows, error: null };
  });
  return builder;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getClaims: vi.fn(async () => ({ data: { claims: { gym_id: "gym-a" } }, error: null })) },
    from: vi.fn(() => makeBuilder()),
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

import { listRefundEligiblePayments } from "./payments";

describe("listRefundEligiblePayments", () => {
  beforeEach(() => {
    calls.length = 0;
    rows = [
      { id: "p1", amount: 10000, currency: "XAF", method: "cash", created_at: "2026-10-01T00:00:00Z", refunds: null },
      { id: "p2", amount: 5000, currency: "XAF", method: "cash", created_at: "2026-10-02T00:00:00Z", refunds: { id: "r1" } },
    ];
  });

  it("asks for verified, subscription-purpose, non-voided payments of the member in the caller's gym", async () => {
    await listRefundEligiblePayments("member-1");

    expect(calls).toContainEqual(["eq", "gym_id", "gym-a"]);
    expect(calls).toContainEqual(["eq", "member_id", "member-1"]);
    expect(calls).toContainEqual(["eq", "status", "verified"]);
    expect(calls).toContainEqual(["eq", "purpose", "subscription"]);
    expect(calls).toContainEqual(["is", "voided_at", null]);
  });

  it("still drops a payment that already has a refund", async () => {
    const result = await listRefundEligiblePayments("member-1");

    expect(result.error).toBeNull();
    expect(result.data?.map((r) => r.id)).toEqual(["p1"]);
  });
});
