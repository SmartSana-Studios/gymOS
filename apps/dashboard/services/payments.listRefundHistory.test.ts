/**
 * Refund history: the dashboard's read of `refunds`, newest first, scoped to the
 * caller's gym, with the actor's name and (for a session payment) whether the
 * paid session had already been used. RLS is the real gate.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: Array<[string, ...unknown[]]> = [];
let refundRows: unknown[];
let memberRows: unknown[];
let total: number | null;

function makeBuilder(table: string) {
  const builder: Record<string, unknown> = {};
  for (const name of ["select", "eq", "order"]) {
    builder[name] = vi.fn((...args: unknown[]) => {
      calls.push([`${table}.${name}`, ...args]);
      return builder;
    });
  }
  builder.limit = vi.fn(async (...args: unknown[]) => {
    calls.push([`${table}.limit`, ...args]);
    return { data: refundRows, count: total, error: null };
  });
  builder.in = vi.fn(async (...args: unknown[]) => {
    calls.push([`${table}.in`, ...args]);
    return { data: memberRows, error: null };
  });
  return builder;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getClaims: vi.fn(async () => ({ data: { claims: { gym_id: "gym-a" } }, error: null })) },
    from: vi.fn((table: string) => makeBuilder(table)),
  })),
}));
vi.mock("@/services/session", () => ({
  mapAndLog: vi.fn(async () => ({ code: "unknown", message: "mapped error" })),
}));
vi.mock("@/lib/i18n/get-request-locale", () => ({ getRequestLocale: vi.fn(async () => "en") }));
vi.mock("@/lib/i18n/get-server-translation", () => ({
  getServerTranslation: vi.fn(async () => ({ t: (key: string) => key })),
}));

import { listRefundHistory, REFUND_HISTORY_LIMIT } from "./payments";

describe("listRefundHistory", () => {
  beforeEach(() => {
    calls.length = 0;
    total = 3;
    memberRows = [{ user_id: "u1", name: "Staff Sam" }];
    refundRows = [
      {
        id: "r1", payment_id: "p1", amount: 2000, currency: "XAF", reason: "Left early",
        created_at: "2026-10-12T10:00:00Z", actor_id: "u1",
        payments: { amount: 2000, method: "cash", purpose: "session", members: { name: "Gina" }, guest_sessions: { consumed_at: "2026-10-12T08:00:00Z", voided_at: null } },
      },
      {
        id: "r2", payment_id: "p2", amount: 2000, currency: "XAF", reason: "Mistake",
        created_at: "2026-10-11T10:00:00Z", actor_id: "u1",
        payments: { amount: 2000, method: "cash", purpose: "session", members: { name: "Hugo" }, guest_sessions: [{ consumed_at: null, voided_at: "2026-10-11T10:00:00Z" }] },
      },
      {
        id: "r3", payment_id: "p3", amount: 5000, currency: "XAF", reason: "Partial",
        created_at: "2026-10-10T10:00:00Z", actor_id: "u-gone",
        payments: { amount: 15000, method: "mobile_money", purpose: "subscription", members: { name: "Ines" }, guest_sessions: null },
      },
    ];
  });

  it("reads the caller's gym newest first with a cap", async () => {
    await listRefundHistory();

    expect(calls).toContainEqual(["refunds.eq", "gym_id", "gym-a"]);
    expect(calls).toContainEqual(["refunds.order", "created_at", { ascending: false }]);
    expect(calls).toContainEqual(["refunds.limit", REFUND_HISTORY_LIMIT]);
  });

  it("maps member, actor, partial amount and the session outcome", async () => {
    const result = await listRefundHistory();

    expect(result.error).toBeNull();
    expect(result.data?.total).toBe(3);
    const [used, unused, subscription] = result.data!.rows;
    expect(used).toMatchObject({ memberName: "Gina", actorName: "Staff Sam", sessionState: "used", reason: "Left early" });
    expect(unused).toMatchObject({ memberName: "Hugo", sessionState: "unused" });
    expect(subscription).toMatchObject({
      memberName: "Ines", amount: 5000, paymentAmount: 15000, sessionState: null, actorName: null,
    });
  });

  it("returns the true total when the list is capped", async () => {
    total = 250;
    const result = await listRefundHistory();
    expect(result.data?.total).toBe(250);
  });
});
