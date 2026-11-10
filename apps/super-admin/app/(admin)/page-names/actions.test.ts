import { beforeEach, describe, expect, it, vi } from "vitest";

let allowed = true;
const rpc = vi.fn();

vi.mock("@/lib/authz-action", () => ({
  authorizeOrRedirect: vi.fn(async () =>
    allowed ? { ok: true, actorId: "sa-1" } : { ok: false, error: { code: "permission_denied", message: "denied" }, reason: "x" },
  ),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => ({ rpc: (...a: unknown[]) => rpc(...a) })) }));
vi.mock("@/services/gyms", () => ({ mapAndLog: vi.fn(async () => ({ code: "unknown", message: "mapped" })) }));
vi.mock("@/lib/i18n/get-request-locale", () => ({ getRequestLocale: vi.fn(async () => "en") }));
vi.mock("@/lib/i18n/get-server-translation", () => ({ getServerTranslation: vi.fn(async () => ({ t: (k: string) => k })) }));

const ID = "00000000-0000-4000-8000-0000000000aa";

beforeEach(() => {
  allowed = true;
  rpc.mockReset();
});

describe("listHeldPageNames", () => {
  it("refuses a denied caller before any database call", async () => {
    allowed = false;
    const { listHeldPageNames } = await import("./actions");
    const res = await listHeldPageNames();
    expect(res.error?.code).toBe("permission_denied");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("maps the queue rows", async () => {
    rpc.mockResolvedValue({
      data: [
        {
          id: ID, gym_id: ID, gym_name: "Iron Gym", name: "x-fitness", origin: "rename", held_reason: "generic_word:fitness",
          held_at: "2026-11-02T10:00:00Z", due_at: "2026-11-04T10:00:00Z", overdue: true, current_name: "iron-yard",
        },
      ],
      error: null,
    });
    const { listHeldPageNames } = await import("./actions");
    const res = await listHeldPageNames();
    expect(rpc).toHaveBeenCalledWith("list_held_page_names");
    expect(res.data).toEqual([
      {
        id: ID, gymId: ID, gymName: "Iron Gym", name: "x-fitness", origin: "rename", heldReason: "generic_word:fitness",
        heldAt: "2026-11-02T10:00:00Z", dueAt: "2026-11-04T10:00:00Z", overdue: true, currentName: "iron-yard",
      },
    ]);
  });
});

describe("decideHeldPageName", () => {
  it("refuses a denied caller before any database call", async () => {
    allowed = false;
    const { decideHeldPageName } = await import("./actions");
    const res = await decideHeldPageName({ id: ID, approve: true, reason: "verified" });
    expect(res.error?.code).toBe("permission_denied");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("needs a reason of 3 to 500 characters for both decisions, before the database", async () => {
    const { decideHeldPageName } = await import("./actions");
    for (const reason of ["", "  ", "ab", "x".repeat(501)]) {
      for (const approve of [true, false]) {
        const res = await decideHeldPageName({ id: ID, approve, reason });
        expect(res.error?.code).toBe("validation_error");
        expect(res.error?.message).toBe("pageNames.errors.reason_required");
      }
    }
    expect((await decideHeldPageName({ id: "nope", approve: true, reason: "verified" })).error?.code).toBe("validation_error");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("passes the decision and the trimmed reason to the database", async () => {
    rpc.mockResolvedValue({ data: { id: ID, name: "x-fitness", state: "active" }, error: null });
    const { decideHeldPageName } = await import("./actions");
    const res = await decideHeldPageName({ id: ID, approve: true, reason: "  Verified as the gym's name  " });
    expect(rpc).toHaveBeenCalledWith("decide_held_page_name", { p_id: ID, p_approve: true, p_reason: "Verified as the gym's name" });
    expect(res).toEqual({ data: { state: "active" }, error: null });
  });

  it("gives each typed refusal its own copy", async () => {
    const { decideHeldPageName } = await import("./actions");
    for (const code of ["not_held", "reserved_name", "name_taken"]) {
      rpc.mockResolvedValueOnce({ data: null, error: { message: `decide_held_page_name: ${code}` } });
      const res = await decideHeldPageName({ id: ID, approve: true, reason: "verified" });
      expect(res.error).toEqual({ code, message: `pageNames.errors.${code}` });
    }
  });

  it("maps any other database error", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "permission denied" } });
    const { decideHeldPageName } = await import("./actions");
    expect((await decideHeldPageName({ id: ID, approve: false, reason: "verified" })).error?.message).toBe("mapped");
  });
});
