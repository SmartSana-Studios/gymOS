/**
 * Story 19.9c: the All Payments ledger read and CSV export -- filters reach the
 * query, unknown params fall back to no filter, the export keeps the 1,000-row
 * ceiling and the role gate.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: Array<[string, ...unknown[]]> = [];
let rows: unknown[];
let count: number;
let role: string;

function makeBuilder() {
  const builder: Record<string, unknown> = {};
  for (const name of ["select", "eq", "in"]) {
    builder[name] = vi.fn((...args: unknown[]) => {
      calls.push([name, ...args]);
      return builder;
    });
  }
  builder.order = vi.fn((...args: unknown[]) => {
    calls.push(["order", ...args]);
    return builder;
  });
  builder.range = vi.fn(async (...args: unknown[]) => {
    calls.push(["range", ...args]);
    return { data: rows, count, error: null };
  });
  // head-count queries and the members lookup resolve when awaited
  builder.then = (resolve: (v: unknown) => void) => resolve({ data: [{ user_id: "u1", name: "Staff Sam" }], count, error: null });
  return builder;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getClaims: vi.fn(async () => ({ data: { claims: { gym_id: "gym-a", app_role: role } }, error: null })) },
    from: vi.fn(() => makeBuilder()),
  })),
}));
vi.mock("@/services/session", () => ({ mapAndLog: vi.fn(async () => ({ code: "unknown", message: "mapped" })) }));
vi.mock("@/lib/i18n/get-request-locale", () => ({ getRequestLocale: vi.fn(async () => "en") }));
vi.mock("@/lib/i18n/get-server-translation", () => ({
  getServerTranslation: vi.fn(async () => ({ t: (key: string) => key })),
}));

import { exportPaymentsCsv, listAllPayments, normalizeLedgerFilters } from "./payments";

const MEMBER = "11111111-1111-4111-8111-111111111111";

function dbRow(over: Record<string, unknown> = {}) {
  return {
    id: "p1",
    member_id: MEMBER,
    amount: 2000,
    currency: "XAF",
    method: "cash",
    purpose: "session",
    status: "verified",
    flagged_reason: null,
    voided_at: null,
    reason: null,
    created_at: "2026-10-11T08:00:00Z",
    actor_id: "u1",
    members: { name: "Guest Gina" },
    ...over,
  };
}

describe("normalizeLedgerFilters", () => {
  it("drops an unknown purpose and a malformed member id", () => {
    expect(normalizeLedgerFilters({ purpose: "junk", memberId: "nope" })).toEqual({
      purpose: undefined,
      memberId: undefined,
    });
    expect(normalizeLedgerFilters({ purpose: "session", memberId: MEMBER })).toEqual({
      purpose: "session",
      memberId: MEMBER,
    });
  });
});

describe("listAllPayments", () => {
  beforeEach(() => {
    calls.length = 0;
    rows = [dbRow()];
    count = 1;
    role = "owner";
  });

  it("filters by purpose and member, newest first, 50 per page, with the actor name", async () => {
    const { data } = await listAllPayments({ purpose: "session", memberId: MEMBER, page: 2 });
    expect(calls).toContainEqual(["eq", "gym_id", "gym-a"]);
    expect(calls).toContainEqual(["eq", "purpose", "session"]);
    expect(calls).toContainEqual(["eq", "member_id", MEMBER]);
    expect(calls).toContainEqual(["order", "created_at", { ascending: false }]);
    expect(calls).toContainEqual(["order", "id", { ascending: false }]);
    expect(calls).toContainEqual(["range", 50, 99]);
    expect(data?.rows[0]).toMatchObject({ memberName: "Guest Gina", actorName: "Staff Sam", purpose: "session" });
  });

  it("does not filter on an unknown purpose", async () => {
    await listAllPayments({ purpose: "junk" });
    expect(calls.some(([n, col]) => n === "eq" && col === "purpose")).toBe(false);
  });
});

describe("exportPaymentsCsv", () => {
  beforeEach(() => {
    calls.length = 0;
    rows = [dbRow({ flagged_reason: "late_confirmation" })];
    count = 1;
    role = "receptionist";
  });

  it("includes a purpose column and honours the filter", async () => {
    const result = await exportPaymentsCsv({ purpose: "session" });
    expect(result.error).toBeNull();
    const lines = (result.data as string).split("\r\n");
    expect(lines[0]).toContain("purpose");
    expect(lines[1]).toContain("session");
    expect(lines[1]).toContain("late_confirmation");
    expect(calls).toContainEqual(["eq", "purpose", "session"]);
  });

  it("returns export_too_large over 1,000 rows without querying data", async () => {
    count = 1001;
    const result = await exportPaymentsCsv({});
    expect(result.error?.code).toBe("export_too_large");
    expect(calls.some(([n]) => n === "range")).toBe(false);
  });

  it("refuses a coach", async () => {
    role = "coach";
    const result = await exportPaymentsCsv({});
    expect(result.error?.code).toBe("forbidden");
  });

  it.each(["owner", "manager", "supervisor", "receptionist"])("allows %s", async (allowed) => {
    role = allowed;
    const result = await exportPaymentsCsv({});
    expect(result.error).toBeNull();
  });

  it("passes the member filter to the data query", async () => {
    await exportPaymentsCsv({ memberId: MEMBER });
    expect(calls).toContainEqual(["eq", "member_id", MEMBER]);
  });

  it("neutralises formulas and quotes commas in names and notes", async () => {
    rows = [dbRow({ members: { name: "=HYPERLINK(1)" }, reason: 'paid, "late"' })];
    const result = await exportPaymentsCsv({});
    const line = (result.data as string).split("\r\n")[1];
    expect(line).toContain(",'=HYPERLINK(1),");
    expect(line).toContain('"paid, ""late"""');
  });

  it("labels an unresolved mobile_money actor as Tara and exports voided rows as true", async () => {
    rows = [dbRow({ method: "mobile_money", actor_id: null, voided_at: "2026-10-11T09:00:00Z" })];
    const result = await exportPaymentsCsv({});
    const cells = (result.data as string).split("\r\n")[1].split(",");
    expect(cells).toContain("payments.ledger.actorTara");
    expect(cells).toContain("true");
  });
});
