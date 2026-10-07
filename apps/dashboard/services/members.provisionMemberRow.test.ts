/**
 * Story 18.5: `provisionMemberRow` accepts an optional plan (a fee-gym create
 * has none) and an `importExempt` flag (CSV import of a fee gym).
 *
 * `importExempt` sets `registration_fee_settled_at` through the ADMIN client
 * between `insertMember` and `insertSubscription` -- the column is writable by
 * service_role / SECURITY DEFINER functions only (0098), so the session client
 * can never do it. A failure there takes the existing cleanup path.
 *
 * Both Supabase clients are replaced with a small recording stub that logs
 * every operation in order, so the ORDER of the three writes is asserted.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Op = { client: "session" | "admin"; table: string; op: string; payload?: unknown };

let ops: Op[];
let eqCalls: Array<{ client: string; table: string; op: string; column: string; value: unknown }>;
let settleResult: { data: { id: string } | null; error: unknown };
let subscriptionInsertResult: { data: { id: string } | null; error: unknown };

function chain(client: "session" | "admin", table: string, op: string, payload?: unknown) {
  ops.push({ client, table, op, payload });
  const builder: Record<string, unknown> = {};
  const passthrough = () => builder;
  builder.eq = (column: string, value: unknown) => {
    eqCalls.push({ client, table, op, column, value });
    return builder;
  };
  builder.is = passthrough;
  builder.select = passthrough;
  builder.single = async () => {
    if (table === "members" && op === "insert") return { data: { id: "member-1" }, error: null };
    return subscriptionInsertResult;
  };
  builder.maybeSingle = async () => {
    if (table === "members" && op === "update") return settleResult;
    if (table === "users") return { data: null, error: null };
    return { data: null, error: null };
  };
  // `await admin.from(..).delete().eq(..)` resolves the builder itself.
  builder.then = (resolve: (value: { error: null }) => unknown) => resolve({ error: null });
  return builder;
}

function makeClient(client: "session" | "admin") {
  return {
    auth: {
      getClaims: async () => ({ data: { claims: { gym_id: "gym-1" } }, error: null }),
      admin: {
        createUser: async () => ({ data: { user: { id: "user-1" } }, error: null }),
        deleteUser: async () => {
          ops.push({ client, table: "auth.users", op: "deleteUser" });
          return { error: null };
        },
      },
    },
    from: (table: string) => ({
      select: () => chain(client, table, "select"),
      insert: (payload: unknown) => chain(client, table, "insert", payload),
      update: (payload: unknown) => chain(client, table, "update", payload),
      delete: () => chain(client, table, "delete"),
    }),
  };
}

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => makeClient("session")) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(() => makeClient("admin")) }));
vi.mock("@/services/session", () => ({
  mapAndLog: vi.fn(async (e: unknown) => ({ code: "unknown", message: String((e as { message?: string })?.message ?? "mapped") })),
}));
vi.mock("@/lib/i18n/get-request-locale", () => ({ getRequestLocale: vi.fn(async () => "en") }));
vi.mock("@/lib/i18n/get-server-translation", () => ({
  getServerTranslation: vi.fn(async () => ({ t: (key: string) => key })),
}));

const identity = {
  name: "Alice",
  phone: "+237680811041",
  email: null,
  dob: null,
  photoUrl: null,
  emergencyContact: null,
  joinDate: "2026-01-15",
};

const summary = () => ops.map((o) => `${o.client}:${o.table}:${o.op}`);

describe("provisionMemberRow (Story 18.5)", () => {
  beforeEach(() => {
    ops = [];
    eqCalls = [];
    settleResult = { data: { id: "member-1" }, error: null };
    subscriptionInsertResult = { data: { id: "sub-1" }, error: null };
  });

  it("without a plan inserts the member and no subscription (fee-gym create)", async () => {
    const { provisionMemberRow } = await import("./members");

    const result = await provisionMemberRow(identity);

    expect(result.error).toBeNull();
    expect(result.data).toMatchObject({ id: "member-1" });
    expect(summary()).toContain("session:members:insert");
    expect(summary()).not.toContain("session:subscriptions:insert");
    expect(summary()).not.toContain("admin:members:update");
  });

  it("with a plan and no importExempt behaves as before: member then subscription, nothing settled", async () => {
    const { provisionMemberRow } = await import("./members");

    const result = await provisionMemberRow({
      ...identity,
      planId: "plan-1",
      subscriptionStatus: "active",
      expiryDate: "2026-02-14",
    });

    expect(result.error).toBeNull();
    const writes = summary().filter((s) => /insert|update|delete/.test(s));
    expect(writes).toEqual(["session:members:insert", "session:subscriptions:insert"]);
  });

  it("importExempt settles the member through the admin client BETWEEN the member insert and the subscription insert", async () => {
    const { provisionMemberRow } = await import("./members");

    const result = await provisionMemberRow({
      ...identity,
      planId: "plan-1",
      subscriptionStatus: "active",
      expiryDate: "2026-02-14",
      importExempt: true,
    });

    expect(result.error).toBeNull();
    const writes = summary().filter((s) => /insert|update|delete/.test(s));
    expect(writes).toEqual(["session:members:insert", "admin:members:update", "session:subscriptions:insert"]);
    const settle = ops.find((o) => o.client === "admin" && o.op === "update");
    expect(settle?.payload).toEqual({ registration_fee_settled_at: expect.any(String) });
    // The admin client bypasses RLS, so the UPDATE must be scoped by gym AND member.
    const settleEqs = eqCalls.filter((c) => c.client === "admin" && c.table === "members" && c.op === "update");
    expect(settleEqs).toContainEqual(expect.objectContaining({ column: "gym_id", value: "gym-1" }));
    expect(settleEqs).toContainEqual(expect.objectContaining({ column: "id", value: "member-1" }));
  });

  it("a failed settle takes the cleanup path: member deleted, no subscription insert attempted", async () => {
    settleResult = { data: null, error: { message: "settle failed" } };
    const { provisionMemberRow } = await import("./members");

    const result = await provisionMemberRow({
      ...identity,
      planId: "plan-1",
      subscriptionStatus: "active",
      expiryDate: "2026-02-14",
      importExempt: true,
    });

    expect(result.data).toBeNull();
    expect(result.error?.message).toBe("settle failed");
    expect(summary()).not.toContain("session:subscriptions:insert");
    expect(summary()).toContain("admin:members:delete");
  });

  it("a settle that matches no row is treated as a failure too", async () => {
    settleResult = { data: null, error: null };
    const { provisionMemberRow } = await import("./members");

    const result = await provisionMemberRow({
      ...identity,
      planId: "plan-1",
      subscriptionStatus: "active",
      expiryDate: null,
      importExempt: true,
    });

    expect(result.data).toBeNull();
    expect(result.error?.code).toBe("not_found");
    expect(summary()).toContain("admin:members:delete");
  });

  it("a failed subscription insert still deletes the just-created member", async () => {
    subscriptionInsertResult = { data: null, error: { message: "gate said no" } };
    const { provisionMemberRow } = await import("./members");

    const result = await provisionMemberRow({
      ...identity,
      planId: "plan-1",
      subscriptionStatus: "active",
      expiryDate: "2026-02-14",
    });

    expect(result.data).toBeNull();
    expect(summary()).toContain("admin:members:delete");
  });
});
