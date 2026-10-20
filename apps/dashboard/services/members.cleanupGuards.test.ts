/**
 * The two compensating-cleanup helpers delete with the service-role key, which bypasses row-level rules. They must refuse
 * anything but the record they exist to undo (epic 22 retro, deferred item on cleanup helpers). Each case records every
 * query and delete the helper makes against a stub admin client.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Call = string;
let calls: Call[];
let eqs: Array<[string, string, unknown]>;
let rows: Record<string, { data: unknown; error: unknown }>;
let userResult: { data: { user: { id: string; created_at: string } | null }; error: unknown };
let deleteUserError: unknown;

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

function table(name: string) {
  const b: Record<string, unknown> = {};
  let op = "select";
  b.select = () => ((op = "select"), b);
  b.delete = () => ((op = "delete"), calls.push(`${name}.delete`), b);
  b.eq = (col: string, val: unknown) => (eqs.push([name, col, val]), b);
  b.limit = () => b;
  b.maybeSingle = async () => (calls.push(`${name}.select`), rows[name] ?? { data: null, error: null });
  // `await admin.from(..).select(..).eq(..).limit(1)` and `.delete().eq(..)` resolve the builder itself.
  b.then = (resolve: (v: { data: unknown; error: unknown }) => unknown) => {
    if (op === "select") calls.push(`${name}.select`);
    return resolve(op === "delete" ? { data: null, error: null } : (rows[name] ?? { data: [], error: null }));
  };
  return b;
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({
    auth: {
      admin: {
        getUserById: async () => (calls.push("auth.getUserById"), userResult),
        deleteUser: async (id: string) => (calls.push(`auth.deleteUser:${id}`), { error: deleteUserError }),
      },
    },
    from: (name: string) => table(name),
  })),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/services/session", () => ({ mapAndLog: vi.fn() }));
vi.mock("@/lib/authz", () => ({ authorizeAction: vi.fn() }));
vi.mock("@/lib/i18n/get-request-locale", () => ({ getRequestLocale: vi.fn(async () => "en") }));
vi.mock("@/lib/i18n/get-server-translation", () => ({ getServerTranslation: vi.fn(async () => ({ t: (k: string) => k })) }));

beforeEach(() => {
  calls = [];
  eqs = [];
  rows = {};
  userResult = { data: { user: { id: "u1", created_at: minutesAgo(2) } }, error: null };
  deleteUserError = null;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("deleteAuthUserForCleanup", () => {
  it("deletes a brand-new account that belongs to no member and is not a platform account", async () => {
    rows = { members: { data: [], error: null }, users: { data: { is_super_admin: false }, error: null } };
    const { deleteAuthUserForCleanup } = await import("./members.provisioning");
    await deleteAuthUserForCleanup("u1");
    expect(calls).toContain("auth.deleteUser:u1");
  });

  it("refuses an account that is not fresh", async () => {
    userResult = { data: { user: { id: "u1", created_at: minutesAgo(61) } }, error: null };
    rows = { members: { data: [], error: null }, users: { data: { is_super_admin: false }, error: null } };
    const { deleteAuthUserForCleanup } = await import("./members.provisioning");
    await deleteAuthUserForCleanup("u1");
    expect(calls.some((c) => c.startsWith("auth.deleteUser"))).toBe(false);
  });

  it("refuses an account that already belongs to a member (it may be another gym's member)", async () => {
    rows = { members: { data: [{ id: "m1" }], error: null }, users: { data: { is_super_admin: false }, error: null } };
    const { deleteAuthUserForCleanup } = await import("./members.provisioning");
    await deleteAuthUserForCleanup("u1");
    expect(calls.some((c) => c.startsWith("auth.deleteUser"))).toBe(false);
  });

  it("refuses a platform (Super Admin) account even if it is new and has no member row", async () => {
    rows = { members: { data: [], error: null }, users: { data: { is_super_admin: true }, error: null } };
    const { deleteAuthUserForCleanup } = await import("./members.provisioning");
    await deleteAuthUserForCleanup("u1");
    expect(calls.some((c) => c.startsWith("auth.deleteUser"))).toBe(false);
  });

  it.each([
    ["the account lookup fails", () => { userResult = { data: { user: null }, error: { message: "boom" } }; }],
    ["the membership check fails", () => { rows = { members: { data: null, error: { message: "boom" } }, users: { data: { is_super_admin: false }, error: null } }; }],
    ["the platform check fails", () => { rows = { members: { data: [], error: null }, users: { data: null, error: { message: "boom" } } }; }],
  ])("fails closed when %s", async (_name, arrange) => {
    arrange();
    const { deleteAuthUserForCleanup } = await import("./members.provisioning");
    await deleteAuthUserForCleanup("u1");
    expect(calls.some((c) => c.startsWith("auth.deleteUser"))).toBe(false);
  });
});

describe("deleteMemberForCleanup", () => {
  it("deletes a fresh member row of this gym, scoped by gym on the delete too", async () => {
    rows = { members: { data: { id: "m1", created_at: minutesAgo(1) }, error: null } };
    const { deleteMemberForCleanup } = await import("./members.provisioning");
    await deleteMemberForCleanup("m1", "gym-1");
    expect(calls).toContain("subscriptions.delete");
    expect(calls).toContain("members.delete");
    // the lookup AND the delete are limited to this gym; the lookup also to role member
    expect(eqs).toContainEqual(["members", "gym_id", "gym-1"]);
    expect(eqs).toContainEqual(["members", "role", "member"]);
    expect(eqs.filter((e) => e[0] === "members" && e[1] === "gym_id").length).toBe(2);
  });

  it("refuses when no such member exists in this gym with role member (wrong gym, staff row, wrong id)", async () => {
    rows = { members: { data: null, error: null } };
    const { deleteMemberForCleanup } = await import("./members.provisioning");
    await deleteMemberForCleanup("m1", "gym-1");
    expect(calls).not.toContain("subscriptions.delete");
    expect(calls).not.toContain("members.delete");
  });

  it("refuses a member row older than an hour", async () => {
    rows = { members: { data: { id: "m1", created_at: minutesAgo(61) }, error: null } };
    const { deleteMemberForCleanup } = await import("./members.provisioning");
    await deleteMemberForCleanup("m1", "gym-1");
    expect(calls).not.toContain("subscriptions.delete");
    expect(calls).not.toContain("members.delete");
  });

  it("fails closed when the lookup errors", async () => {
    rows = { members: { data: null, error: { message: "boom" } } };
    const { deleteMemberForCleanup } = await import("./members.provisioning");
    await deleteMemberForCleanup("m1", "gym-1");
    expect(calls).not.toContain("members.delete");
  });
});
