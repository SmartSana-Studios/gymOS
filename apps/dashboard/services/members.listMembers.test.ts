/**
 * Story 18.5: `listMembers` surfaces the awaiting-registration-fee state.
 *
 * - `registration_fee_settled_at` is selected and mapped onto the row.
 * - The "awaiting_registration_fee" filter is a plain column filter on
 *   `members` (`registration_fee_settled_at is null`), NEVER an inner join on
 *   subscriptions: an awaiting member has no subscription row to join to, so an
 *   inner join would silently exclude exactly the members the filter is for.
 * - The existing subscription-status filters keep their inner join.
 *
 * The Supabase client is a recording stub: every chained call is logged and the
 * awaited builder resolves to the configured rows.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

let calls: Array<[string, unknown[]]>;
let result: { data: unknown[]; count: number; error: unknown };

function makeBuilder() {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "order", "limit", "or", "not", "is", "range"]) {
    builder[method] = (...args: unknown[]) => {
      calls.push([method, args]);
      return builder;
    };
  }
  builder.then = (resolve: (value: typeof result) => unknown) => resolve(result);
  return builder;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getClaims: async () => ({ data: { claims: { gym_id: "gym-1" } }, error: null }) },
    from: () => makeBuilder(),
  })),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/services/session", () => ({ mapAndLog: vi.fn(async () => ({ code: "unknown", message: "mapped" })) }));
vi.mock("@/lib/i18n/get-request-locale", () => ({ getRequestLocale: vi.fn(async () => "en") }));
vi.mock("@/lib/i18n/get-server-translation", () => ({
  getServerTranslation: vi.fn(async () => ({ t: (key: string) => key })),
}));

const selectString = () => String(calls.find(([m]) => m === "select")?.[1][0]);
const hasCall = (method: string, ...args: unknown[]) =>
  calls.some(([m, a]) => m === method && args.every((arg, i) => a[i] === arg));

describe("listMembers (Story 18.5)", () => {
  beforeEach(() => {
    calls = [];
    result = { data: [], count: 0, error: null };
  });

  it("selects registration_fee_settled_at and maps it onto the row", async () => {
    result = {
      data: [
        {
          id: "m1",
          name: "Awaiting",
          phone: "+237680811041",
          email: null,
          dob: null,
          photo_url: null,
          emergency_contact: null,
          join_date: "2026-01-15",
          deactivated_at: null,
          registration_fee_settled_at: null,
          subscriptions: [],
        },
        {
          id: "m2",
          name: "Settled without plan",
          phone: "+237680811042",
          email: null,
          dob: null,
          photo_url: null,
          emergency_contact: null,
          join_date: "2026-01-15",
          deactivated_at: null,
          registration_fee_settled_at: "2026-01-16T10:00:00Z",
          subscriptions: [],
        },
      ],
      count: 2,
      error: null,
    };
    const { listMembers } = await import("./members");

    const out = await listMembers({});

    expect(selectString()).toContain("registration_fee_settled_at");
    expect(out.data?.rows[0]).toMatchObject({ registrationFeeSettledAt: null, status: "no_active_plan" });
    expect(out.data?.rows[1]).toMatchObject({
      registrationFeeSettledAt: "2026-01-16T10:00:00Z",
      status: "no_active_plan",
    });
  });

  it("the awaiting filter is registration_fee_settled_at IS NULL on members, with a left (not inner) subscriptions join", async () => {
    const { listMembers } = await import("./members");

    await listMembers({ status: "awaiting_registration_fee" });

    expect(hasCall("is", "registration_fee_settled_at", null)).toBe(true);
    expect(hasCall("is", "deactivated_at", null)).toBe(true);
    expect(selectString()).not.toContain("!inner");
    expect(hasCall("eq", "subscriptions.status")).toBe(false);
  });

  it("a subscription-status filter keeps its inner join and does not touch the fee column", async () => {
    const { listMembers } = await import("./members");

    await listMembers({ status: "active" });

    expect(selectString()).toContain("subscriptions!inner(");
    expect(hasCall("eq", "subscriptions.status", "active")).toBe(true);
    expect(hasCall("is", "registration_fee_settled_at", null)).toBe(false);
  });

  it("exportMembersCsv applies the same awaiting filter without an inner join", async () => {
    const { exportMembersCsv } = await import("./members");

    await exportMembersCsv({ status: "awaiting_registration_fee" });

    expect(hasCall("is", "registration_fee_settled_at", null)).toBe(true);
    expect(hasCall("is", "deactivated_at", null)).toBe(true);
    expect(calls.filter(([m]) => m === "select").every(([, a]) => !String(a[0]).includes("!inner"))).toBe(true);
  });

  it("honours a valid pageSize for the range and clamps an invalid one to the default 25", async () => {
    const { listMembers } = await import("./members");
    const rangeCall = () => calls.find(([m]) => m === "range")?.[1];

    await listMembers({ page: 2, pageSize: 10 });
    expect(rangeCall()).toEqual([10, 19]);

    calls = [];
    await listMembers({ page: 2, pageSize: 100000 });
    expect(rangeCall()).toEqual([25, 49]);
  });
});
