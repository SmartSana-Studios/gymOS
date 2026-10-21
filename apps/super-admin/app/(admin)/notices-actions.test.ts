/** Story 23.9: the Super Admin bell reads and clears only the caller's own notices, behind the platform gate. */
import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
let allowed = true;
vi.mock("@/lib/authz-action", () => ({
  authorizeOrRedirect: vi.fn(async () => (allowed ? { ok: true, actorId: "sa-1" } : { ok: false, error: { code: "permission_denied", message: "denied" }, reason: "x" })),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => ({ rpc: (...a: unknown[]) => rpc(...a) })) }));
vi.mock("@/services/gyms", () => ({ mapAndLog: vi.fn(async () => ({ code: "unknown", message: "mapped" })) }));

describe("Super Admin notices", () => {
  beforeEach(() => {
    rpc.mockReset();
    allowed = true;
  });

  it("returns the caller's notices and the unread count", async () => {
    rpc.mockImplementation(async (fn: string) =>
      fn === "get_staff_notices"
        ? { data: [{ id: "n1", title_en: "T", title_fr: "TF", body_en: "B", body_fr: "BF", created_at: "2026-10-21T10:00:00Z", read_at: null }], error: null }
        : { data: 4, error: null },
    );
    const { getAdminNotices } = await import("./notices-actions");

    const res = await getAdminNotices();

    expect(res.data?.unread).toBe(4);
    expect(res.data?.notices[0]).toMatchObject({ id: "n1", titleFr: "TF", readAt: null });
  });

  it("a denied gate reaches no database call", async () => {
    allowed = false;
    const { getAdminNotices, markAdminNoticesRead } = await import("./notices-actions");

    expect((await getAdminNotices()).error?.code).toBe("permission_denied");
    expect((await markAdminNoticesRead()).error?.code).toBe("permission_denied");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("marking read clears all of the caller's own", async () => {
    rpc.mockResolvedValue({ data: 2, error: null });
    const { markAdminNoticesRead } = await import("./notices-actions");

    expect((await markAdminNoticesRead()).error).toBeNull();
    expect(rpc).toHaveBeenCalledWith("mark_staff_notices_read", { p_ids: null });
  });
});
