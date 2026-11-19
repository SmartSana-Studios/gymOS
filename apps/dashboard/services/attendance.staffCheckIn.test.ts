/**
 * Story 27.3: the attendance service's staff check-in surface. The RPC results map to the coded outcomes (a refusal is data, not an
 * error), staff_check_in is called with the member id only (no time, no scan id), the Daily Log reads list_attendance_log (so a voided
 * row is returned), the member search needs 2 letters or 3 digits, matches accent-insensitively and by digits in any country-code form,
 * and the pattern it builds can never carry a backslash or a quote into the filter.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Call = [string, ...unknown[]];
let calls: Call[];
let rpcResult: { data: unknown; error: unknown; count?: number | null };
let fromResult: { data: unknown; error: unknown; count?: number | null };
// per-table answers for a read that touches several tables; any other table answers fromResult
let tableResults: Record<string, { data: unknown; error: unknown; count?: number | null }> = {};

function builder(result: () => unknown) {
  const b: Record<string, unknown> = {};
  for (const m of ["select", "eq", "is", "gte", "lt", "in", "or", "order", "limit", "range", "ilike"]) {
    b[m] = (...args: unknown[]) => {
      calls.push([m, ...args]);
      return b;
    };
  }
  b.then = (resolve: (v: unknown) => unknown, reject: (r: unknown) => unknown) => Promise.resolve(result()).then(resolve, reject);
  return b;
}

const rpc = vi.fn((fn: string, args: unknown, opts?: unknown) => {
  calls.push(["rpc", fn, args, opts]);
  return builder(() => rpcResult);
});
const from = vi.fn((table: string) => {
  calls.push(["from", table]);
  return builder(() => tableResults[table] ?? fromResult);
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getClaims: vi.fn(async () => ({ data: { claims: { gym_id: "gym-1", app_role: claimRole } }, error: null })) },
    rpc,
    from,
  })),
}));
vi.mock("@/services/session", () => ({ mapAndLog: vi.fn(async () => ({ code: "unknown", message: "mapped error" })) }));
vi.mock("@/lib/i18n/get-request-locale", () => ({ getRequestLocale: vi.fn(async () => "en") }));
vi.mock("@/lib/i18n/get-server-translation", () => ({ getServerTranslation: vi.fn(async () => ({ t: (key: string) => key })) }));
vi.mock("@/services/gym-settings", () => ({ getGymLocalPeriodBounds: vi.fn() }));

let claimRole = "receptionist";

import { accentInsensitivePattern, isSearchTermLongEnough, phoneSearchDigits } from "@/lib/attendance-search";
import { getCurrentlyCheckedIn, listAttendanceLog, searchMembersForCheckIn, staffCheckIn, voidStaffCheckIn } from "./attendance";

describe("staffCheckIn", () => {
  beforeEach(() => {
    calls = [];
    claimRole = "receptionist";
  });

  it("calls staff_check_in with the member id and nothing else, and maps a coded refusal as data", async () => {
    rpcResult = {
      data: [{ outcome: "rejected_expired", attendance_id: null, checked_in_at: null, member_status: "expired", expiry_date: "2026-11-10", days_since_expiry: 5, grace_ends_on: null, since: null, session_amount: null }],
      error: null,
    };
    const { data, error } = await staffCheckIn("m-1");
    expect(error).toBeNull();
    expect(data).toMatchObject({ outcome: "rejected_expired", daysSinceExpiry: 5, expiryDate: "2026-11-10", memberStatus: "expired" });
    const call = calls.find((c) => c[0] === "rpc");
    expect(call?.[1]).toBe("staff_check_in");
    expect(call?.[2]).toEqual({ p_member_id: "m-1" });
  });

  it("returns the mapped error when the call fails (a suspended gym, a refused role)", async () => {
    rpcResult = { data: null, error: { message: "boom" } };
    const { data, error } = await staffCheckIn("m-1");
    expect(data).toBeNull();
    expect(error?.message).toBe("mapped error");
  });
});

describe("voidStaffCheckIn", () => {
  beforeEach(() => {
    calls = [];
  });
  it("maps the later-visit refusal with the staff flag, and a success with what was given back", async () => {
    rpcResult = { data: [{ outcome: "later_visit_relies", attendance_id: "a", voided_at: null, session_released: null, stamp_removed: null, later_is_staff_entry: true }], error: null };
    expect((await voidStaffCheckIn("a", "wrong member")).data).toMatchObject({ outcome: "later_visit_relies", laterIsStaffEntry: true, sessionReleased: false });
    rpcResult = { data: [{ outcome: "voided", attendance_id: "a", voided_at: "2026-11-15T08:00:00Z", session_released: true, stamp_removed: true, later_is_staff_entry: null }], error: null };
    expect((await voidStaffCheckIn("a", "wrong member")).data).toMatchObject({ outcome: "voided", sessionReleased: true, stampRemoved: true });
    expect(calls.find((c) => c[0] === "rpc")?.[2]).toEqual({ p_attendance_id: "a", p_reason: "wrong member" });
  });
});

describe("listAttendanceLog (list_attendance_log)", () => {
  beforeEach(() => {
    calls = [];
    claimRole = "manager";
  });
  it("reads the RPC (voided rows included) with the date window, newest first, and maps entry and void data", async () => {
    rpcResult = {
      data: [
        {
          attendance_id: "a1", member_id: "m1", member_name: "Paul E.", checked_in_at: "2026-11-15T06:50:00Z", checked_out_at: "2026-11-15T06:51:00Z",
          checkout_type: "void", source: "staff", entered_by_label: "Aicha M.", voided_at: "2026-11-15T06:55:00Z", voided_by_label: "GymOS Support",
          void_reason: "wrong member", voidable: false, consumed_session: null, earned_stamp: null,
        },
      ],
      error: null,
      count: 1,
    };
    const { data } = await listAttendanceLog({ from: "2026-11-15", to: "2026-11-15", page: 1, pageSize: 10 });
    expect(data?.rows[0]).toMatchObject({ id: "a1", source: "staff", enteredByLabel: "Aicha M.", voidedAt: "2026-11-15T06:55:00Z", voidedByLabel: "GymOS Support", voidReason: "wrong member", voidable: false });
    const rpcCall = calls.find((c) => c[0] === "rpc");
    expect(rpcCall?.[1]).toBe("list_attendance_log");
    expect(rpcCall?.[2]).toEqual({ p_from: "2026-11-15T00:00:00.000Z", p_to: "2026-11-16T00:00:00.000Z" });
    expect(calls.some((c) => c[0] === "from")).toBe(false);
  });

  it("filters the member name on the RPC rows, orders newest first, pages with range, and maps the Void modal's two flags for a voidable row", async () => {
    rpcResult = {
      data: [
        {
          attendance_id: "a2", member_id: "m2", member_name: "Paul E.", checked_in_at: "2026-11-15T08:00:00Z", checked_out_at: null,
          checkout_type: null, source: "staff", entered_by_label: "Brice N.", voided_at: null, voided_by_label: null,
          void_reason: null, voidable: true, consumed_session: true, consumed_session_paid: false, earned_stamp: false,
        },
      ],
      error: null,
      count: 12,
    };
    const { data } = await listAttendanceLog({ from: "2026-11-15", to: "2026-11-15", page: 2, pageSize: 10, memberSearch: "pau%l" });
    expect(data?.rows[0]).toMatchObject({ id: "a2", voidable: true, consumedSession: true, consumedSessionPaid: false, earnedStamp: false, voidedAt: null });
    expect(data?.page).toBe(2);
    expect(calls).toContainEqual(["ilike", "member_name", "%pau\\%l%"]);
    expect(calls).toContainEqual(["order", "checked_in_at", { ascending: false }]);
    expect(calls).toContainEqual(["order", "attendance_id", { ascending: true }]);
    expect(calls).toContainEqual(["range", 10, 19]);
    expect(calls.find((c) => c[0] === "rpc")?.[3]).toEqual({ count: "exact" });
  });
});

const ATT_STAFF_1 = { id: "a1", member_id: "m1", checked_in_at: "2026-11-15T07:02:00Z", source: "staff", members: { name: "Ange T.", deactivated_at: null } };
const ATT_SCAN = { id: "a2", member_id: "m2", checked_in_at: "2026-11-15T06:40:00Z", source: "qr", members: { name: "Jean B.", deactivated_at: null } };
const ATT_STAFF_3 = { id: "a3", member_id: "m3", checked_in_at: "2026-11-15T06:30:00Z", source: "staff", members: { name: "Paul E.", deactivated_at: null } };
const LOG_A1 = {
  attendance_id: "a1", member_id: "m1", member_name: "Ange T.", checked_in_at: "2026-11-15T07:02:00Z", checked_out_at: null, checkout_type: null,
  source: "staff", entered_by_label: "Brice N.", voided_at: null, voided_by_label: null, void_reason: null, voidable: true, consumed_session: true, consumed_session_paid: true, earned_stamp: true,
};

describe("getCurrentlyCheckedIn", () => {
  beforeEach(() => {
    calls = [];
    tableResults = {};
  });

  it("staff: reads attendance_counted, and maps the entry label and the void flags of the staff rows onto the right rows", async () => {
    claimRole = "manager";
    tableResults = {
      attendance_counted: { data: [ATT_STAFF_3, ATT_SCAN, ATT_STAFF_1], error: null, count: 3 },
      subscriptions: { data: [{ member_id: "m1", status: "active", created_at: "2026-10-01" }], error: null },
    };
    rpcResult = { data: [LOG_A1], error: null };
    const { data } = await getCurrentlyCheckedIn({ page: 1, pageSize: 10 });
    const byId = Object.fromEntries((data?.rows ?? []).map((r) => [r.attendanceId, r]));
    expect(byId.a1).toMatchObject({ source: "staff", enteredByLabel: "Brice N.", voidable: true, consumedSession: true, consumedSessionPaid: true, earnedStamp: true, status: "active" });
    expect(byId.a2).toMatchObject({ source: "qr", enteredByLabel: null, voidable: false, consumedSession: null, earnedStamp: null });
    // a staff row the log did not return keeps the safe defaults
    expect(byId.a3).toMatchObject({ source: "staff", enteredByLabel: null, voidable: false });
    // one enrichment read, from the earliest staff entry on the page
    const rpcCalls = calls.filter((c) => c[0] === "rpc");
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0][1]).toBe("list_attendance_log");
    expect((rpcCalls[0][2] as { p_from: string }).p_from).toBe("2026-11-15T06:30:00Z");
    expect(calls).toContainEqual(["from", "attendance_counted"]);
  });

  it("staff: a failed enrichment never blocks the page, and leaves [Void] hidden", async () => {
    claimRole = "owner";
    tableResults = { attendance_counted: { data: [ATT_STAFF_1], error: null, count: 1 }, subscriptions: { data: [], error: null } };
    rpcResult = { data: null, error: { message: "boom" } };
    const { data, error } = await getCurrentlyCheckedIn({ page: 1, pageSize: 10 });
    expect(error).toBeNull();
    expect(data?.rows[0]).toMatchObject({ attendanceId: "a1", source: "staff", enteredByLabel: null, voidable: false });
  });

  it("staff: a page of scans asks nothing of the log", async () => {
    claimRole = "receptionist";
    tableResults = { attendance_counted: { data: [ATT_SCAN], error: null, count: 1 }, subscriptions: { data: [], error: null } };
    await getCurrentlyCheckedIn({ page: 1, pageSize: 10 });
    expect(calls.some((c) => c[0] === "rpc")).toBe(false);
  });

  it("support: reads the open rows from list_attendance_log (never attendance_counted), clamping a page past the end", async () => {
    claimRole = "support";
    tableResults = { subscriptions: { data: [], error: null } };
    rpcResult = { data: [LOG_A1], error: null, count: 1 };
    const { data } = await getCurrentlyCheckedIn({ page: 5, pageSize: 10 });
    expect(calls.some((c) => c[0] === "from" && c[1] === "attendance_counted")).toBe(false);
    expect(calls).toContainEqual(["is", "checked_out_at", null]);
    expect(calls).toContainEqual(["is", "voided_at", null]);
    expect(calls.filter((c) => c[0] === "rpc")).toHaveLength(2);
    expect(calls.filter((c) => c[0] === "range")).toEqual([["range", 40, 49], ["range", 0, 9]]);
    expect(data?.page).toBe(1);
    expect(data?.total).toBe(1);
    expect(data?.rows[0]).toMatchObject({ attendanceId: "a1", enteredByLabel: "Brice N.", voidable: true, status: "no_active_plan" });
  });
});

describe("member search for the check-in modal", () => {
  beforeEach(() => {
    calls = [];
    claimRole = "receptionist";
    fromResult = { data: [], error: null };
    tableResults = {};
  });

  it("needs 2 letters or 3 digits", () => {
    expect(isSearchTermLongEnough("A")).toBe(false);
    expect(isSearchTermLongEnough("An")).toBe(true);
    expect(isSearchTermLongEnough("67")).toBe(false);
    expect(isSearchTermLongEnough("670")).toBe(true);
    expect(isSearchTermLongEnough("+2")).toBe(false);
  });

  it("queries nothing under the threshold", async () => {
    await searchMembersForCheckIn("A");
    expect(calls).toEqual([]);
  });

  it("builds an accent-insensitive pattern that carries no backslash and no quote", () => {
    const pattern = accentInsensitivePattern('Ángé "x" \\ .*');
    expect(pattern).not.toMatch(/[\\"]/);
    expect(pattern.startsWith("[aàáâãäåAÀÁÂÃÄÅ][nñNÑ]g[eèéêëEÈÉÊË]")).toBe(true);
    expect(new RegExp(accentInsensitivePattern("Ange"), "i").test("ANGÉ T.")).toBe(true);
    expect(new RegExp(accentInsensitivePattern("Ange"), "i").test("Berthe")).toBe(false);
  });

  it("reads phone digits in any country-code form", () => {
    expect(phoneSearchDigits("+237 6 70 11")).toBe("23767011");
    expect(phoneSearchDigits("00237670")).toBe("237670");
    expect(phoneSearchDigits("670-11")).toBe("67011");
  });

  it("searches this gym's members by name or phone, up to 8 rows, and reports more", async () => {
    fromResult = {
      data: Array.from({ length: 9 }, (_, i) => ({
        id: `m${i}`, name: `Ange ${i}`, phone: `+23765544330${i}`, photo_url: null, deactivated_at: i === 1 ? "2026-11-01T00:00:00Z" : null,
        subscriptions: [{ created_at: "2026-10-01T00:00:00Z", status: "active", plans: { name: "Monthly" } }],
      })),
      error: null,
    };
    const { data } = await searchMembersForCheckIn("Ange 655");
    expect(data?.rows).toHaveLength(8);
    expect(data?.hasMore).toBe(true);
    expect(data?.rows[0]).toMatchObject({ planName: "Monthly", status: "active" });
    expect(data?.rows[1].deactivatedAt).not.toBeNull(); // deactivated members are returned: the server answers R8
    expect(calls).toContainEqual(["eq", "gym_id", "gym-1"]);
    expect(calls).toContainEqual(["eq", "role", "member"]);
    expect(calls).toContainEqual(["limit", 9]);
    const or = calls.find((c) => c[0] === "or")?.[1] as string;
    expect(or).toContain("name.imatch.");
    expect(or).toContain('phone.ilike."%655%"');
    // the staff read of who is inside
    expect(calls).toContainEqual(["from", "attendance_counted"]);
  });

  it("a GymOS Support caller does not read attendance (it has no policy on it)", async () => {
    claimRole = "support";
    fromResult = { data: [{ id: "m1", name: "Ange", phone: null, photo_url: null, deactivated_at: null, subscriptions: [] }], error: null };
    await searchMembersForCheckIn("Ange");
    expect(calls.some((c) => c[0] === "from" && c[1] === "attendance_counted")).toBe(false);
  });
});
