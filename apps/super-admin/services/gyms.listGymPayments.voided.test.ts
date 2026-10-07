import { describe, expect, it, vi } from "vitest";

// Records every filter listGymPayments applies to the payments query.
const filters: [string, ...unknown[]][] = [];
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    const q: Record<string, unknown> = {};
    q.select = () => q;
    q.eq = (...a: unknown[]) => (filters.push(["eq", ...a]), q);
    q.is = (...a: unknown[]) => (filters.push(["is", ...a]), q);
    q.order = () => q;
    q.range = () => Promise.resolve({ data: [], error: null, count: 0 });
    return { from: () => q };
  },
}));
vi.mock("@/lib/i18n/get-request-locale", () => ({ getRequestLocale: async () => "en" }));
vi.mock("@/lib/i18n/get-server-translation", () => ({
  getServerTranslation: async () => ({ t: (k: string) => k }),
}));

import { listGymPayments } from "./gyms";

describe("listGymPayments", () => {
  it("excludes voided payments (a voided registration fee never counted as money)", async () => {
    filters.length = 0;
    await listGymPayments("00000000-0000-4000-8000-000000000001", { page: 1 });
    expect(filters).toContainEqual(["is", "voided_at", null]);
  });
});
