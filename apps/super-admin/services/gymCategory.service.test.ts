import { beforeEach, describe, expect, it, vi } from "vitest";

// Story 21.1: the list and detail reads must select and map gyms.category, and
// setGymCategory must go through the set_gym_category RPC (the column is pinned
// against direct UPDATE).
const selectArgs: string[] = [];
const rpc = vi.fn(async (...args: unknown[]) => (void args, ({ data: null, error: null as unknown })));

const ROW = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Yoga House",
  status: "active",
  category: "yoga_studio",
  created_at: "2026-10-01T00:00:00Z",
  tier_id: "00000000-0000-4000-8000-000000000002",
  member_cap_override: null,
  tiers: { name: "Starter", member_cap: 50 },
  members: [{ name: "Owner", phone: "+237670000000", role: "owner" }],
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    const q: Record<string, unknown> = {};
    q.select = (cols: string) => {
      selectArgs.push(cols);
      return q;
    };
    q.order = () => q;
    q.eq = () => q;
    q.range = () => Promise.resolve({ data: [ROW], error: null, count: 1 });
    q.maybeSingle = () => Promise.resolve({ data: ROW, error: null });
    return { from: () => q, rpc: (fn: string, args: unknown) => (fn === "gym_member_count" ? Promise.resolve({ data: 3, error: null }) : rpc(fn, args)) };
  },
}));
vi.mock("@/lib/i18n/get-request-locale", () => ({ getRequestLocale: async () => "en" }));
vi.mock("@/lib/i18n/get-server-translation", () => ({
  getServerTranslation: async () => ({ t: (k: string) => k }),
}));

import { getGymDetail, listGyms, setGymCategory } from "./gyms";

beforeEach(() => {
  selectArgs.length = 0;
  rpc.mockClear();
});

describe("gym category reads and write", () => {
  it("listGyms selects and maps category", async () => {
    const { data } = await listGyms();
    expect(selectArgs.join(" ")).toContain("category");
    expect(data?.rows[0]?.category).toBe("yoga_studio");
  });

  it("getGymDetail selects and maps category", async () => {
    const { data } = await getGymDetail(ROW.id);
    expect(selectArgs.join(" ")).toContain("category");
    expect(data?.category).toBe("yoga_studio");
  });

  it("setGymCategory calls the set_gym_category RPC with the gym id and code", async () => {
    const { error } = await setGymCategory(ROW.id, "other");
    expect(error).toBeNull();
    expect(rpc).toHaveBeenCalledWith("set_gym_category", { p_gym_id: ROW.id, p_category: "other" });
  });
});
