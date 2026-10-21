/** Story 23.9: the services map the database's snake_case notice rows, French text included. */
import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => ({ rpc: (...a: unknown[]) => rpc(...a) })) }));
vi.mock("@/services/session", () => ({ mapAndLog: vi.fn(async () => ({ code: "unknown", message: "mapped" })) }));

import { getStaffNotices, markStaffNoticesRead } from "./staff-notices";

describe("staff notices service", () => {
  beforeEach(() => rpc.mockReset());

  it("maps every field, title_fr and body_fr included, and the unread count", async () => {
    rpc.mockImplementation(async (fn: string) =>
      fn === "get_staff_notices"
        ? { data: [{ id: "n1", notice_type: "payment_connection_changed", title_en: "T", title_fr: "TF", body_en: "B", body_fr: "BF", created_at: "2026-10-21T10:00:00Z", read_at: null }], error: null }
        : { data: 2, error: null },
    );
    const res = await getStaffNotices(10);
    expect(rpc).toHaveBeenCalledWith("get_staff_notices", { p_limit: 10 });
    expect(res.data).toEqual({
      notices: [{ id: "n1", noticeType: "payment_connection_changed", titleEn: "T", titleFr: "TF", bodyEn: "B", bodyFr: "BF", createdAt: "2026-10-21T10:00:00Z", readAt: null }],
      unread: 2,
    });
  });

  it("returns a mapped error when either call fails", async () => {
    rpc.mockImplementation(async (fn: string) => (fn === "get_staff_notices" ? { data: null, error: { message: "x" } } : { data: 0, error: null }));
    expect((await getStaffNotices()).error).toEqual({ code: "unknown", message: "mapped" });
  });

  it("marks all of the caller's notices read when no ids are given", async () => {
    rpc.mockResolvedValue({ data: 3, error: null });
    expect((await markStaffNoticesRead()).error).toBeNull();
    expect(rpc).toHaveBeenCalledWith("mark_staff_notices_read", { p_ids: null });
  });
});
