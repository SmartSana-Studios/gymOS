/**
 * Story 19.10: `getMemberListRow()` backs the `/members?memberId=` deep link.
 * Pinned: a malformed id never reaches the database; the read is gym-scoped and
 * `role = 'member'`; a miss is `null` data with no error; a hit maps to the
 * same MemberListRow shape the list passes the modal.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Call = [string, ...unknown[]];

let calls: Call[];
let result: { data: unknown; error: unknown };

function makeBuilder() {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "order", "limit", "maybeSingle"]) {
    builder[method] = (...args: unknown[]) => {
      calls.push([method, ...args]);
      return method === "maybeSingle" ? Promise.resolve(result) : builder;
    };
  }
  return builder;
}

const from = vi.fn((table: string) => {
  calls.push(["from", table]);
  return makeBuilder();
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getClaims: vi.fn(async () => ({ data: { claims: { gym_id: "gym-1" } }, error: null })) },
    from,
  })),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/services/session", () => ({
  mapAndLog: vi.fn(async () => ({ code: "unknown", message: "mapped error" })),
}));
vi.mock("@/lib/i18n/get-request-locale", () => ({ getRequestLocale: vi.fn(async () => "en") }));
vi.mock("@/lib/i18n/get-server-translation", () => ({
  getServerTranslation: vi.fn(async () => ({ t: (key: string) => key })),
}));

import { getMemberListRow } from "./members";

const ID = "11111111-1111-4111-8111-111111111111";

describe("getMemberListRow", () => {
  beforeEach(() => {
    calls = [];
    from.mockClear();
    result = { data: null, error: null };
  });

  it("does not query for a malformed id", async () => {
    expect(await getMemberListRow("not-a-uuid")).toEqual({ data: null, error: null });
    expect(from).not.toHaveBeenCalled();
  });

  it("scopes to the caller's gym, member rows and the id", async () => {
    await getMemberListRow(ID);
    expect(calls).toContainEqual(["eq", "gym_id", "gym-1"]);
    expect(calls).toContainEqual(["eq", "role", "member"]);
    expect(calls).toContainEqual(["eq", "id", ID]);
  });

  it("returns null data and no error on a miss", async () => {
    expect(await getMemberListRow(ID)).toEqual({ data: null, error: null });
  });

  it("maps a hit to a MemberListRow with its latest subscription", async () => {
    result = {
      data: {
        id: ID,
        name: "Amina",
        phone: "+237680811041",
        email: null,
        dob: null,
        photo_url: null,
        emergency_contact: null,
        join_date: "2026-01-01",
        deactivated_at: null,
        registration_fee_settled_at: "2026-01-02T00:00:00Z",
        subscriptions: [
          { status: "active", expiry_date: "2026-12-01", plan_id: "p1", created_at: "x", plans: { name: "Monthly", plan_type: "monthly" } },
        ],
      },
      error: null,
    };
    const { data } = await getMemberListRow(ID);
    expect(data).toMatchObject({ id: ID, name: "Amina", planName: "Monthly", status: "active", expiryDate: "2026-12-01" });
  });

  it("maps a query error", async () => {
    result = { data: null, error: { message: "boom" } };
    const { data, error } = await getMemberListRow(ID);
    expect(data).toBeNull();
    expect(error).toEqual({ code: "unknown", message: "mapped error" });
  });
});
