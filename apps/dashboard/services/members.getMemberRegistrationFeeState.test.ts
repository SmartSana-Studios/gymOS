/**
 * Story 18.6: `getMemberRegistrationFeeState` backs the member detail's fee line
 * and the void dialog. Awaiting / paid / waived / none, gym-scoped, with the
 * waive actor and reason returned only to roles that can read the audit log.
 * The mocks record every filter call, so dropping a filter fails a test.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Call = [string, string, ...unknown[]];

let role: string;
let member: { registration_fee_settled_at: string | null } | null;
// Rows as the database holds them; the stub applies the recorded `.is("voided_at", null)`.
let paymentRows: Array<{ id: string; amount: number; currency: string; method: string; created_at: string; voided_at: string | null }>;
let waiveRow: { actor_id: string | null; actor_display_name: string; metadata: unknown; created_at: string } | null;
let waiveError: unknown;
let actorRows: { user_id: string; name: string }[];
let calls: Call[];
let adminCalled: boolean;

function makeBuilder(scope: string, table: string, resolve: (builder: Record<string, unknown>) => unknown) {
  const filters: { voidedNull: boolean } = { voidedNull: false };
  const builder: Record<string, unknown> = {};
  for (const name of ["select", "eq", "order", "limit"]) {
    builder[name] = (...args: unknown[]) => {
      calls.push([scope + table, name, ...args]);
      return builder;
    };
  }
  builder.is = (column: string, value: unknown) => {
    calls.push([scope + table, "is", column, value]);
    if (column === "voided_at" && value === null) filters.voidedNull = true;
    return builder;
  };
  builder.in = async (...args: unknown[]) => {
    calls.push([scope + table, "in", ...args]);
    return { data: actorRows, error: null };
  };
  builder.maybeSingle = async () => resolve({ ...builder, filters });
  return builder;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getClaims: async () => ({ data: { claims: { gym_id: "gym-1", app_role: role } }, error: null }) },
    from: (table: string) =>
      makeBuilder("", table, (b) => {
        if (table === "members") return { data: member, error: null };
        const { voidedNull } = b.filters as { voidedNull: boolean };
        const live = paymentRows.filter((r) => !voidedNull || r.voided_at === null);
        return { data: live[0] ?? null, error: null };
      }),
  })),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => {
    adminCalled = true;
    return {
      from: (table: string) => makeBuilder("admin:", table, () => ({ data: waiveRow, error: waiveError })),
    };
  }),
}));
vi.mock("@/services/session", () => ({ mapAndLog: vi.fn(async () => ({ code: "unknown", message: "mapped" })) }));
vi.mock("@/lib/i18n/get-request-locale", () => ({ getRequestLocale: vi.fn(async () => "en") }));
vi.mock("@/lib/i18n/get-server-translation", () => ({
  getServerTranslation: vi.fn(async () => ({ t: (key: string) => key })),
}));

const SETTLED_AT = "2026-10-01T10:00:00Z";

function payment(overrides: Partial<(typeof paymentRows)[number]> = {}) {
  return { id: "pay-1", amount: 5000, currency: "XAF", method: "cash", created_at: "2026-09-30T00:00:00Z", voided_at: null, ...overrides };
}

describe("getMemberRegistrationFeeState (Story 18.6)", () => {
  beforeEach(() => {
    role = "owner";
    member = { registration_fee_settled_at: SETTLED_AT };
    paymentRows = [];
    waiveRow = null;
    waiveError = null;
    actorRows = [];
    calls = [];
    adminCalled = false;
  });

  it("reports awaiting when the member has not settled, reading nothing else", async () => {
    member = { registration_fee_settled_at: null };
    const { getMemberRegistrationFeeState } = await import("./members");

    const result = await getMemberRegistrationFeeState("m1");

    expect(result).toEqual({ data: { kind: "awaiting" }, error: null });
    expect(adminCalled).toBe(false);
    expect(calls).toContainEqual(["members", "eq", "gym_id", "gym-1"]);
    expect(calls).toContainEqual(["members", "eq", "role", "member"]);
    expect(calls).toContainEqual(["members", "eq", "id", "m1"]);
    expect(calls.some(([scope]) => scope === "payments")).toBe(false);
  });

  it("reports the fee payment with the settle time, filtered to a live verified fee row, newest first, one row", async () => {
    paymentRows = [payment()];
    const { getMemberRegistrationFeeState } = await import("./members");

    const result = await getMemberRegistrationFeeState("m1");

    expect(result.data).toEqual({
      kind: "paid",
      paymentId: "pay-1",
      amount: 5000,
      currency: "XAF",
      method: "cash",
      paidAt: SETTLED_AT,
    });
    expect(calls).toContainEqual(["payments", "eq", "purpose", "registration_fee"]);
    expect(calls).toContainEqual(["payments", "eq", "status", "verified"]);
    expect(calls).toContainEqual(["payments", "eq", "gym_id", "gym-1"]);
    expect(calls).toContainEqual(["payments", "eq", "member_id", "m1"]);
    expect(calls).toContainEqual(["payments", "is", "voided_at", null]);
    expect(calls).toContainEqual(["payments", "order", "created_at", { ascending: false }]);
    expect(calls).toContainEqual(["payments", "limit", 1]);
  });

  it("ignores a voided fee payment when a live one also exists", async () => {
    paymentRows = [
      payment({ id: "pay-voided", amount: 4000, voided_at: "2026-09-30T12:00:00Z" }),
      payment({ id: "pay-live" }),
    ];
    const { getMemberRegistrationFeeState } = await import("./members");

    const result = await getMemberRegistrationFeeState("m1");

    expect(result.data).toMatchObject({ kind: "paid", paymentId: "pay-live", amount: 5000 });
  });

  it("does not report a voided-only fee as paid", async () => {
    paymentRows = [payment({ voided_at: "2026-09-30T12:00:00Z" })];
    const { getMemberRegistrationFeeState } = await import("./members");

    const result = await getMemberRegistrationFeeState("m1");

    expect(result.data).toEqual({ kind: "none" });
  });

  it("names the waiver and the reason for a role that can read the audit log", async () => {
    waiveRow = { actor_id: "user-1", actor_display_name: "Fallback", metadata: { reason: "Friend of the owner" }, created_at: SETTLED_AT };
    actorRows = [{ user_id: "user-1", name: "Marie Owner" }];
    const { getMemberRegistrationFeeState } = await import("./members");

    const result = await getMemberRegistrationFeeState("m1");

    expect(result.data).toEqual({ kind: "waived", waivedByName: "Marie Owner", reason: "Friend of the owner" });
    expect(calls).toContainEqual(["admin:audit_log", "eq", "gym_id", "gym-1"]);
    expect(calls).toContainEqual(["admin:audit_log", "eq", "action_type", "registration_fee_waived"]);
    expect(calls).toContainEqual(["admin:audit_log", "eq", "target_entity_id", "m1"]);
    expect(calls).toContainEqual(["admin:audit_log", "order", "created_at", { ascending: false }]);
    expect(calls).toContainEqual(["admin:audit_log", "limit", 1]);
  });

  it("shows a receptionist only that the fee was waived, with no name or reason", async () => {
    role = "receptionist";
    waiveRow = { actor_id: "user-1", actor_display_name: "Marie Owner", metadata: { reason: "Friend of the owner" }, created_at: SETTLED_AT };
    actorRows = [{ user_id: "user-1", name: "Marie Owner" }];
    const { getMemberRegistrationFeeState } = await import("./members");

    const result = await getMemberRegistrationFeeState("m1");

    expect(result.data).toEqual({ kind: "waived", waivedByName: null, reason: null });
    expect(calls.some(([scope, name]) => scope === "members" && name === "in")).toBe(false);
  });

  it("returns a mapped error when the admin audit read fails", async () => {
    waiveError = { message: "audit read failed" };
    const { getMemberRegistrationFeeState } = await import("./members");

    const result = await getMemberRegistrationFeeState("m1");

    expect(result.data).toBeNull();
    expect(result.error?.code).toBe("unknown");
  });

  it("reports none for a settled member with no payment and no waive row", async () => {
    const { getMemberRegistrationFeeState } = await import("./members");

    const result = await getMemberRegistrationFeeState("m1");

    expect(result.data).toEqual({ kind: "none" });
  });

  it("returns not_found for a stale, cross-gym or non-member id", async () => {
    member = null;
    const { getMemberRegistrationFeeState } = await import("./members");

    const result = await getMemberRegistrationFeeState("m-missing");

    expect(result.data).toBeNull();
    expect(result.error?.code).toBe("not_found");
  });
});
