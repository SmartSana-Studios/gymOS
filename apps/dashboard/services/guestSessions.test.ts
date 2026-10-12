/**
 * Story 19.9b: listMemberGuestSessions -- 90-day cutoff for voided and lapsed
 * rows, source from payment_id, method and recorder from the payments embed.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

let sessionRows: unknown[];
let actorRows: unknown[];
let rpcResult: { data: unknown; error: unknown } = { data: [], error: null };
const rpcCalls: [string, Record<string, unknown>][] = [];

function from(table: string) {
  const b: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "order", "limit"]) b[m] = () => b;
  b.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data: table === "members" ? actorRows : sessionRows, error: null }).then(resolve);
  return b;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getClaims: async () => ({ data: { claims: { gym_id: "gym-1" } }, error: null }) },
    from,
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push([fn, args]);
      return rpcResult;
    },
  })),
}));
vi.mock("@/services/session", () => ({ mapAndLog: vi.fn(async () => ({ code: "unknown", message: "m" })) }));
vi.mock("@/lib/i18n/get-request-locale", () => ({ getRequestLocale: vi.fn(async () => "en") }));
vi.mock("@/lib/i18n/get-server-translation", () => ({
  getServerTranslation: vi.fn(async () => ({ t: (k: string) => k })),
}));

const day = 86_400_000;
const ago = (d: number) => new Date(Date.now() - d * day).toISOString();
const ahead = (d: number) => new Date(Date.now() + d * day).toISOString();

const row = (o: Record<string, unknown>) => ({
  id: "s",
  payment_id: "p1",
  loyalty_grant_id: null,
  created_at: ago(1),
  usable_until: ahead(5),
  consumed_at: null,
  covered_day: null,
  voided_at: null,
  payments: { method: "cash", actor_id: "u1" },
  ...o,
});

describe("listMemberGuestSessions", () => {
  beforeEach(() => {
    actorRows = [{ user_id: "u1", name: "Rita" }];
  });

  it("drops voided and lapsed rows older than 90 days, keeps recent and used ones", async () => {
    sessionRows = [
      row({ id: "old-void", voided_at: ago(100) }),
      row({ id: "new-void", voided_at: ago(5) }),
      row({ id: "old-lapse", usable_until: ago(100) }),
      row({ id: "new-lapse", usable_until: ago(10) }),
      row({ id: "used", consumed_at: ago(200), usable_until: ago(190), covered_day: "2026-01-01" }),
    ];
    const { listMemberGuestSessions } = await import("./guestSessions");
    const { data } = await listMemberGuestSessions("m1");
    expect(data?.map((s) => s.id)).toEqual(["new-void", "new-lapse", "used"]);
  });

  it("marks a row without payment_id as free, with no method or recorder", async () => {
    sessionRows = [row({ payment_id: null, loyalty_grant_id: "g1", payments: null })];
    const { listMemberGuestSessions } = await import("./guestSessions");
    const { data } = await listMemberGuestSessions("m1");
    expect(data?.[0]).toMatchObject({ source: "free", method: null, recordedByName: null });
  });

  it("reads method and recorder from an array-shaped payments embed", async () => {
    sessionRows = [row({ payments: [{ method: "manual_momo", actor_id: "u1" }] })];
    const { listMemberGuestSessions } = await import("./guestSessions");
    const { data } = await listMemberGuestSessions("m1");
    expect(data?.[0]).toMatchObject({ source: "paid", method: "manual_momo", recordedByName: "Rita" });
  });

  it("gives a null recorder when the actor cannot be resolved", async () => {
    actorRows = [];
    sessionRows = [row({})];
    const { listMemberGuestSessions } = await import("./guestSessions");
    const { data } = await listMemberGuestSessions("m1");
    expect(data?.[0].recordedByName).toBeNull();
  });
});

describe("Story 19.10 readers", () => {
  it("maps the summary row and defaults a missing row to zeros", async () => {
    rpcResult = {
      data: [{ paid_count: 3, blocked_count: 2, blocked_members: 1, free_count: 0 }],
      error: null,
    };
    const { getGuestSessionsSummary } = await import("./guestSessions");
    const { data } = await getGuestSessionsSummary("month");
    expect(rpcCalls.at(-1)).toEqual(["guest_sessions_summary", { p_period: "month" }]);
    expect(data).toEqual({ paid: 3, blocked: 2, blockedMembers: 1, free: 0 });

    rpcResult = { data: [], error: null };
    expect((await getGuestSessionsSummary("today")).data).toEqual({
      paid: 0,
      blocked: 0,
      blockedMembers: 0,
      free: 0,
    });
  });

  it("maps a 42501 refusal to the permission copy, not the raw message", async () => {
    rpcResult = { data: null, error: { code: "42501", message: "guest_sessions: permission denied" } };
    const { getGuestSessionsSummary } = await import("./guestSessions");
    const { data, error } = await getGuestSessionsSummary("today");
    expect(data).toBeNull();
    expect(error).toEqual({ code: "forbidden", message: "guestSessions.permissionDenied" });
  });

  it("pages 50 rows at a time and maps paid rows with group totals", async () => {
    rpcResult = {
      data: [
        {
          payment_id: "p1",
          member_id: "m1",
          member_name: "Amina",
          amount: 5000,
          method: "cash",
          created_at: "2026-10-12T08:00:00Z",
          consumed_at: null,
          refund_state: "refunded",
          recorder_id: "u1",
          recorder_name: "Rita",
          recorder_kind: "staff",
          group_sessions: 3,
          group_total: 12000,
          total_count: 61,
        },
      ],
      error: null,
    };
    const { listPaidGuestSessions } = await import("./guestSessions");
    const { data } = await listPaidGuestSessions({
      period: "today",
      page: 2,
      refundedAfterUseOnly: true,
      groupByRecorder: false,
    });
    expect(rpcCalls.at(-1)).toEqual([
      "list_guest_sessions_paid",
      {
        p_period: "today",
        p_refunded_after_use_only: true,
        p_group_by_recorder: false,
        p_limit: 50,
        p_offset: 50,
      },
    ]);
    expect(data?.total).toBe(61);
    expect(data?.rows[0]).toMatchObject({
      paymentId: "p1",
      refundState: "refunded",
      recorderName: "Rita",
      groupSessions: 3,
      groupTotal: 12000,
    });
  });

  it("maps blocked attempts and free sessions", async () => {
    rpcResult = {
      data: [
        {
          attempt_id: "a1",
          member_id: "m1",
          member_name: "Amina",
          source: "class",
          class_name: "Spin",
          attempt_time: "2026-10-12T07:00:00Z",
          scanned_at: "2026-10-12T07:00:00Z",
          synced_at: "2026-10-12T09:00:00Z",
          total_count: 1,
        },
      ],
      error: null,
    };
    const { listBlockedSessionAttempts, listFreeGuestSessions } = await import("./guestSessions");
    const blocked = await listBlockedSessionAttempts({ period: "month", page: 1 });
    expect(blocked.data?.rows[0]).toMatchObject({ id: "a1", className: "Spin", scannedAt: "2026-10-12T07:00:00Z",
      syncedAt: "2026-10-12T09:00:00Z",
    });

    rpcResult = {
      data: [
        {
          session_id: "s1",
          member_id: "m1",
          member_name: "Amina",
          earned_at: "2026-10-01T00:00:00Z",
          usable_until: "2026-11-30T00:00:00Z",
          status: "available",
          total_count: 1,
        },
      ],
      error: null,
    };
    const free = await listFreeGuestSessions({ period: "month", page: 1 });
    expect(free.data?.rows[0]).toMatchObject({ id: "s1", status: "available" });
  });
});
