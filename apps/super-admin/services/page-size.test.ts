import { describe, expect, it, vi } from "vitest";

// Records the .range() window listGyms asks Supabase for.
const range = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    const q: Record<string, unknown> = {};
    q.select = () => q;
    q.order = () => q;
    q.range = (from: number, to: number) => {
      range(from, to);
      return Promise.resolve({ data: [], error: null, count: 0 });
    };
    return { from: () => q };
  },
}));
vi.mock("@/lib/i18n/get-request-locale", () => ({ getRequestLocale: async () => "en" }));
vi.mock("@/lib/i18n/get-server-translation", () => ({
  getServerTranslation: async () => ({ t: (k: string) => k }),
}));

import { listGyms } from "./gyms";

describe("listGyms pageSize", () => {
  it.each([
    [5, 5],
    [50, 50],
    [undefined, 20],
    [100000, 20],
    [7, 20],
    [Number.NaN, 20],
  ])("pageSize %s resolves to %s", async (input, expected) => {
    range.mockClear();
    const { data } = await listGyms({ page: 2, pageSize: input });
    expect(data?.pageSize).toBe(expected);
    expect(range).toHaveBeenCalledWith(expected, expected * 2 - 1);
  });
});
