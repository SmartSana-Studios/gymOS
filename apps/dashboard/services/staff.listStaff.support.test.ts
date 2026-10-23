import { describe, expect, it, vi } from "vitest";

// Story 23.2: the Owner staff list selects the explicit staff roles, so a support membership can never appear.
const filters: [string, ...unknown[]][] = [];
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => {
    const q: Record<string, unknown> = {};
    q.select = () => q;
    q.eq = () => q;
    q.in = (...a: unknown[]) => (filters.push(["in", ...a]), q);
    q.neq = (...a: unknown[]) => (filters.push(["neq", ...a]), q);
    q.order = () => Promise.resolve({ data: [], error: null });
    return {
      auth: { getClaims: async () => ({ data: { claims: { gym_id: "gym-1" } }, error: null }) },
      from: () => q,
    };
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/services/session", () => ({ mapAndLog: vi.fn(async () => ({ code: "unknown", message: "mapped" })) }));
vi.mock("@/lib/i18n/get-request-locale", () => ({ getRequestLocale: vi.fn(async () => "en") }));
vi.mock("@/lib/i18n/get-server-translation", () => ({
  getServerTranslation: vi.fn(async () => ({ t: (key: string) => key })),
}));

import { listStaff } from "./staff";

describe("listStaff", () => {
  it("selects only the explicit staff roles (never support)", async () => {
    filters.length = 0;
    await listStaff();
    const inCall = filters.find(([m]) => m === "in");
    expect(inCall?.[1]).toBe("role");
    expect(inCall?.[2]).toEqual(["owner", "supervisor", "manager", "receptionist", "coach"]);
    expect(inCall?.[2]).not.toContain("support");
    expect(filters.some(([m]) => m === "neq")).toBe(false);
  });
});
