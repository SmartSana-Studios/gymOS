import { beforeEach, describe, expect, it, vi } from "vitest";

// Story 23.10: the Owner review queue of staff GymOS Support created, and the tag on the staff list.
const rpc = vi.fn();
let listRows: unknown[] = [];
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => {
    const q: Record<string, unknown> = {};
    q.select = () => q;
    q.eq = () => q;
    q.in = () => q;
    q.order = () => Promise.resolve({ data: listRows, error: null });
    return {
      auth: { getClaims: async () => ({ data: { claims: { gym_id: "gym-1" } }, error: null }) },
      from: () => q,
      rpc: (...a: unknown[]) => rpc(...a),
    };
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({
    from: () => ({ select: () => ({ in: () => Promise.resolve({ data: [{ id: "u1", must_change_password: false }], error: null }) }) }),
  })),
}));
vi.mock("@/services/session", () => ({ mapAndLog: vi.fn(async () => ({ code: "unknown", message: "mapped" })) }));
vi.mock("@/lib/i18n/get-request-locale", () => ({ getRequestLocale: vi.fn(async () => "en") }));
vi.mock("@/lib/i18n/get-server-translation", () => ({
  getServerTranslation: vi.fn(async () => ({ t: (key: string) => key })),
}));

import { clearSupportReview, listStaff, listSupportReviewQueue } from "./staff";

describe("staff support review", () => {
  beforeEach(() => {
    rpc.mockReset();
    listRows = [];
  });

  it("listStaff carries the created_by_support tag as createdBySupport", async () => {
    listRows = [
      { id: "m1", name: "Coach One", phone: null, role: "coach", user_id: "u1", deactivated_at: null, created_by_support: true },
      { id: "m2", name: "Manager", phone: null, role: "manager", user_id: "u1", deactivated_at: null, created_by_support: false },
    ];
    const { data } = await listStaff();
    expect(data?.map((r) => r.createdBySupport)).toEqual([true, false]);
  });

  it("listSupportReviewQueue maps the RPC rows and never exposes anything but the staff member", async () => {
    rpc.mockResolvedValue({
      data: [{ member_id: "m1", name: "Coach One", role: "coach", member_since: "2026-10-01", flagged_at: "2026-10-21T10:00:00Z" }],
      error: null,
    });
    const { data, error } = await listSupportReviewQueue();
    expect(rpc).toHaveBeenCalledWith("get_support_review_queue");
    expect(error).toBeNull();
    expect(data).toEqual([{ memberId: "m1", name: "Coach One", role: "coach", flaggedAt: "2026-10-21T10:00:00Z" }]);
  });

  it("a refused read (not the Owner) is an error, not an empty queue", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "permission denied" } });
    const { data, error } = await listSupportReviewQueue();
    expect(data).toBeNull();
    expect(error?.code).toBe("unknown");
  });

  it("clearSupportReview passes the member id and reports ok", async () => {
    rpc.mockResolvedValue({ data: [{ ok: true, code: "cleared" }], error: null });
    const res = await clearSupportReview("m1");
    expect(rpc).toHaveBeenCalledWith("clear_support_review", { p_member_id: "m1" });
    expect(res).toEqual({ data: { ok: true }, error: null });
  });

  it("clearing something that is not in the queue is not_found", async () => {
    rpc.mockResolvedValue({ data: [{ ok: false, code: "not_found" }], error: null });
    const res = await clearSupportReview("m9");
    expect(res.data).toBeNull();
    expect(res.error?.code).toBe("not_found");
  });
});
