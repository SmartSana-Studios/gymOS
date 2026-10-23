/**
 * Story 26.1: the members CSV export carries birth_year, profession and
 * neighborhood as its LAST three columns, with the text fields formula-guarded.
 * Synthetic rows only.
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

import { exportMembersCsv } from "./members.export";

function row(overrides: Record<string, unknown>) {
  return {
    id: "m1",
    name: "Test Member",
    phone: "+237600000001",
    email: null,
    join_date: "2026-01-15",
    deactivated_at: null,
    birth_year: null,
    profession: null,
    neighborhood: null,
    subscriptions: [],
    ...overrides,
  };
}

describe("exportMembersCsv profile columns (Story 26.1)", () => {
  beforeEach(() => {
    calls = [];
    result = { data: [], count: 0, error: null };
  });

  it("selects the three columns and puts them last in the header", async () => {
    const { data } = await exportMembersCsv({});
    const select = calls.filter(([m]) => m === "select").map(([, a]) => String(a[0]));
    expect(select.some((s) => s.includes("birth_year, profession, neighborhood"))).toBe(true);
    const header = data!.split("\r\n")[0].split(",");
    expect(header.slice(-3)).toEqual(["birth_year", "profession", "neighborhood"]);
    expect(header.slice(0, 7)).toEqual([
      "member_name", "phone", "plan_type", "join_date", "subscription_status", "expiry_date", "last_check_in_date",
    ]);
  });

  it("writes the values, empty when null", async () => {
    result = {
      data: [row({ birth_year: 1984, profession: "Welder", neighborhood: "Ngui" }), row({ name: "Blank Member" })],
      count: 2,
      error: null,
    };
    const { data } = await exportMembersCsv({});
    const lines = data!.split("\r\n");
    expect(lines[1].split(",").slice(-3)).toEqual(["1984", "Welder", "Ngui"]);
    expect(lines[2].split(",").slice(-3)).toEqual(["", "", ""]);
  });

  it("quotes a value that contains a comma or a quote, so the columns stay aligned", async () => {
    result = { data: [row({ profession: 'Chef "pro"', neighborhood: "Quartier, Est" })], count: 1, error: null };
    const { data } = await exportMembersCsv({});
    const line = data!.split("\r\n")[1];
    expect(line.endsWith(',"Chef ""pro""","Quartier, Est"')).toBe(true);
  });

  it.each(["=SUM(A1)", "+1", "-1", "@cmd"])("neutralises a text value starting with %s", async (value) => {
    result = { data: [row({ profession: value, neighborhood: value })], count: 1, error: null };
    const { data } = await exportMembersCsv({});
    const cols = data!.split("\r\n")[1].split(",");
    expect(cols.slice(-2)).toEqual([`'${value}`, `'${value}`]);
  });
});
