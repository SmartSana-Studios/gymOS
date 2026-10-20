import { describe, expect, it, vi } from "vitest";

// Story 23.2: the Super Admin gym members list never includes a GymOS support membership.
const filters: [string, ...unknown[]][] = [];
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    const q: Record<string, unknown> = {};
    q.select = () => q;
    q.eq = (...a: unknown[]) => (filters.push(["eq", ...a]), q);
    q.neq = (...a: unknown[]) => (filters.push(["neq", ...a]), q);
    q.order = () => q;
    q.range = () => Promise.resolve({ data: [], error: null, count: 0 });
    return { from: () => q };
  },
}));
vi.mock("@/lib/i18n/get-request-locale", () => ({ getRequestLocale: async () => "en" }));
vi.mock("@/lib/i18n/get-server-translation", () => ({
  getServerTranslation: async () => ({ t: (k: string) => k }),
}));

import { listGymMembers } from "./gyms";

describe("listGymMembers", () => {
  it("excludes support memberships", async () => {
    filters.length = 0;
    await listGymMembers("00000000-0000-4000-8000-000000000001", { page: 1 });
    expect(filters).toContainEqual(["neq", "role", "support"]);
  });
});
