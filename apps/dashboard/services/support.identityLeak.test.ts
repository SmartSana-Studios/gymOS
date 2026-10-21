/**
 * Story 23.8 (FR-187, retro 66): per-surface leak test for the dashboard services that show "recorded by".
 *
 * The data the gym holds names only the per-gym proxy (an opaque id). The real support person is held in support_action_identity (Super
 * Admin read only) and in users/support_assignments (not readable by a gym role). For every surface that resolves an actor:
 *   - the proxy shows as "GymOS Support";
 *   - nothing the surface returns contains the real id, name, phone or email;
 *   - the service never reads a table or RPC that could hold the real person.
 * The scan is shown to catch a seeded leak (a service that reads support_action_identity).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const REAL = {
  id: "00000000-0000-0000-0000-000000238101",
  name: "Zed Realperson",
  phone: "+237677238101",
  email: "zed.realperson@gymosapps.com",
};
const PROXY_ID = "00000000-0000-0000-0000-0000000000aa";
const STAFF_ID = "00000000-0000-0000-0000-0000000000bb";
const FORBIDDEN_TABLES = ["support_action_identity", "users", "support_assignments", "audit_disclosure_requests"];
const FORBIDDEN_RPCS = ["get_support_action_identity", "get_support_accounts", "get_support_assignments", "get_disclosure_inbox"];

const reads: string[] = [];
const rpcs: string[] = [];
let tables: Record<string, unknown[]>;
let claims: Record<string, unknown>;

function makeBuilder(table: string) {
  const builder: Record<string, unknown> = {};
  const result = () => ({ data: tables[table] ?? [], count: (tables[table] ?? []).length, error: null });
  for (const name of ["select", "eq", "neq", "order", "range", "limit", "gte", "lt", "not", "is"]) {
    builder[name] = vi.fn(() => builder);
  }
  // .in("user_id", ids) filters like the database does, so only the asked-for actors come back
  builder.in = vi.fn((_column: string, ids: string[]) => {
    const rows = (tables[table] ?? []).filter((row) => ids.includes((row as { user_id: string }).user_id));
    return Promise.resolve({ data: rows, error: null });
  });
  builder.maybeSingle = vi.fn(async () => ({ data: (tables[table] ?? [])[0] ?? null, error: null }));
  builder.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve);
  return builder;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getClaims: vi.fn(async () => ({ data: { claims }, error: null })) },
    from: vi.fn((table: string) => {
      reads.push(table);
      return makeBuilder(table);
    }),
    rpc: vi.fn(async (fn: string) => {
      rpcs.push(fn);
      if (fn === "get_gym_support_proxy_id") return { data: PROXY_ID, error: null };
      if (fn === "get_support_action_identity") return { data: [{ real_user_id: REAL.id, real_name: REAL.name, real_email: REAL.email }], error: null };
      return { data: [], error: null };
    }),
  })),
}));
vi.mock("@/services/session", () => ({
  mapAndLog: vi.fn(async () => ({ code: "unknown", message: "mapped error" })),
}));
vi.mock("@/lib/i18n/get-request-locale", () => ({ getRequestLocale: vi.fn(async () => "en") }));
vi.mock("@/lib/i18n/get-server-translation", () => ({
  getServerTranslation: vi.fn(async () => ({ t: (key: string) => key })),
}));

import { listPendingPayments, listAllPayments, listRefundHistory, exportPaymentsCsv } from "./payments";
import { listMemberGuestSessions } from "./guestSessions";
import { listAuditLog, listAuditActors, exportAuditLogCsv } from "./auditLog";
import { resolveActorNames, SUPPORT_ACTOR_LABEL } from "./actorNames";

const MEMBER_ID = "00000000-0000-0000-0000-0000000000cc";

function seed() {
  const payment = {
    id: "p1", member_id: MEMBER_ID, amount: 2000, currency: "XAF", method: "cash", purpose: "session", status: "pending",
    flagged_reason: null, voided_at: null, reason: "walk-in", created_at: "2026-10-20T10:00:00Z", actor_id: PROXY_ID,
    members: { name: "Gina", phone: "+237600000001" }, refunds: null,
  };
  tables = {
    // Leak-prone sources seeded with the real person: a members row (as if RLS did not hide it), users, the identity table.
    members: [
      { user_id: STAFF_ID, name: "Staff Sam" },
      { user_id: REAL.id, name: REAL.name, phone: REAL.phone, email: REAL.email },
    ],
    users: [{ id: REAL.id, display_name: REAL.name, phone: REAL.phone }],
    support_action_identity: [{ real_user_id: REAL.id, real_name: REAL.name, real_email: REAL.email }],
    payments: [payment, { ...payment, id: "p2", actor_id: STAFF_ID }],
    refunds: [
      {
        id: "r1", payment_id: "p1", amount: 500, currency: "XAF", reason: "mistake", created_at: "2026-10-20T11:00:00Z", actor_id: PROXY_ID,
        payments: { amount: 2000, method: "cash", purpose: "subscription", members: { name: "Gina" }, guest_sessions: null },
      },
    ],
    guest_sessions: [
      {
        id: "g1", payment_id: "p1", loyalty_grant_id: null, created_at: "2026-10-20T10:00:00Z", usable_until: "2999-01-01T00:00:00Z",
        consumed_at: null, covered_day: "2026-10-20", voided_at: null, payments: { method: "cash", actor_id: PROXY_ID },
      },
    ],
    audit_log: [
      {
        id: "a1", actor_id: PROXY_ID, actor_display_name: SUPPORT_ACTOR_LABEL, action_type: "refund_recorded", target_entity_id: "p1",
        target_entity_type: "payment", metadata: { amount: 500 }, created_at: "2026-10-20T11:00:00Z",
      },
    ],
  };
}

function assertNoRealPerson(surface: string, output: unknown) {
  const text = JSON.stringify(output);
  for (const needle of [REAL.id, REAL.name, REAL.phone, REAL.email, "Realperson"]) {
    expect(text.includes(needle), `${surface} leaked ${needle}`).toBe(false);
  }
}

function assertOnlyGymReads(surface: string) {
  for (const table of FORBIDDEN_TABLES) expect(reads, `${surface} read ${table}`).not.toContain(table);
  for (const fn of FORBIDDEN_RPCS) expect(rpcs, `${surface} called ${fn}`).not.toContain(fn);
}

beforeEach(() => {
  reads.length = 0;
  rpcs.length = 0;
  claims = { gym_id: "gym-a", app_role: "owner", sub: "owner-1" };
  seed();
});

describe("resolveActorNames", () => {
  it("names the proxy GymOS Support and a staff member by name", async () => {
    const supabase = (await (await import("@/lib/supabase/server")).createClient()) as never;
    const result = await resolveActorNames(supabase, "gym-a", [PROXY_ID, STAFF_ID]);
    expect(result.error).toBeNull();
    expect(result.data?.get(PROXY_ID)).toBe("GymOS Support");
    expect(result.data?.get(STAFF_ID)).toBe("Staff Sam");
  });

  it("leaves an unknown id unnamed and never reads the identity table", async () => {
    const supabase = (await (await import("@/lib/supabase/server")).createClient()) as never;
    const result = await resolveActorNames(supabase, "gym-a", [PROXY_ID, "unknown-id"]);
    expect(result.data?.has("unknown-id")).toBe(false);
    assertNoRealPerson("resolveActorNames", [...(result.data?.values() ?? [])]);
    assertOnlyGymReads("resolveActorNames");
  });
});

describe("per-surface: a support-recorded row shows GymOS Support and never the individual", () => {
  it("pending payments", async () => {
    const { data } = await listPendingPayments();
    expect(data?.find((row) => row.id === "p1")?.actorName).toBe("GymOS Support");
    expect(data?.find((row) => row.id === "p2")?.actorName).toBe("Staff Sam");
    assertNoRealPerson("listPendingPayments", data);
    assertOnlyGymReads("listPendingPayments");
  });

  it("payments ledger", async () => {
    const { data } = await listAllPayments({});
    expect(JSON.stringify(data)).toContain("GymOS Support");
    assertNoRealPerson("listAllPayments", data);
    assertOnlyGymReads("listAllPayments");
  });

  it("refund approvers", async () => {
    const { data } = await listRefundHistory();
    expect(data?.rows[0]?.actorName).toBe("GymOS Support");
    assertNoRealPerson("listRefundHistory", data);
    assertOnlyGymReads("listRefundHistory");
  });

  it("payments CSV export", async () => {
    const { data } = await exportPaymentsCsv({});
    expect(data).toContain("GymOS Support");
    assertNoRealPerson("exportPaymentsCsv", data);
    assertOnlyGymReads("exportPaymentsCsv");
  });

  it("member guest sessions (recorded by)", async () => {
    const { data } = await listMemberGuestSessions(MEMBER_ID);
    expect(data?.[0]?.recordedByName).toBe("GymOS Support");
    assertNoRealPerson("listMemberGuestSessions", data);
    assertOnlyGymReads("listMemberGuestSessions");
  });

  it("audit trail, actor filter and CSV export", async () => {
    const log = await listAuditLog({});
    expect(log.data?.rows[0]?.actorDisplayName).toBe("GymOS Support");
    assertNoRealPerson("listAuditLog", log.data);
    const actors = await listAuditActors();
    expect(actors.data).toEqual([{ actorId: PROXY_ID, actorDisplayName: "GymOS Support" }]);
    assertNoRealPerson("listAuditActors", actors.data);
    const csv = await exportAuditLogCsv({});
    expect(csv.data).toContain("GymOS Support");
    assertNoRealPerson("exportAuditLogCsv", csv.data);
    assertOnlyGymReads("audit trail");
  });
});

describe("the scan can fail", () => {
  it("fails when a service resolves a payment to the real person (deliberately leaking mock)", async () => {
    (tables.payments[0] as { actor_id: string }).actor_id = REAL.id;
    const { data } = await listPendingPayments();
    expect(() => assertNoRealPerson("leaking listPendingPayments", data)).toThrow();
  });

  it("catches a surface that reads the identity table or returns the real person", () => {
    reads.push("support_action_identity");
    expect(() => assertOnlyGymReads("seeded")).toThrow();
    expect(() => assertNoRealPerson("seeded", { by: REAL.name })).toThrow();
    expect(() => assertNoRealPerson("seeded", { by: REAL.email })).toThrow();
  });
});
