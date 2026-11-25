/**
 * Story 28.1: listMemberGuestSessions carries validityMode, coveredKind, coveredAttendanceId and coveredBookingId; a consumed row with no
 * covered day (a Single-use row) comes back used and never throws. guestSessions.test.ts runs unchanged beside this file.
 */
import { describe, expect, it, vi } from "vitest";

let sessionRows: unknown[] = [];
let lastSelect = "";

function from(table: string) {
  const b: Record<string, unknown> = {};
  b.select = (columns: string) => {
    if (table === "guest_sessions") lastSelect = columns;
    return b;
  };
  for (const m of ["eq", "in", "order", "limit"]) b[m] = () => b;
  b.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data: table === "members" ? [] : sessionRows, error: null }).then(resolve);
  return b;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getClaims: async () => ({ data: { claims: { gym_id: "gym-1" } }, error: null }) },
    from,
    rpc: async () => ({ data: [], error: null }),
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
  validity_mode: null,
  covered_kind: null,
  covered_attendance_id: null,
  covered_booking_id: null,
  voided_at: null,
  payments: { method: "cash", actor_id: null },
  ...o,
});

describe("listMemberGuestSessions cover fields", () => {
  it("selects the four cover columns", async () => {
    sessionRows = [];
    const { listMemberGuestSessions } = await import("./guestSessions");
    await listMemberGuestSessions("m1");
    for (const column of ["validity_mode", "covered_kind", "covered_attendance_id", "covered_booking_id"]) {
      expect(lastSelect).toContain(column);
    }
  });

  it("maps a whole_day day row", async () => {
    sessionRows = [row({ consumed_at: ago(1), covered_day: "2026-11-18", validity_mode: "whole_day", covered_kind: "day" })];
    const { listMemberGuestSessions } = await import("./guestSessions");
    const { data } = await listMemberGuestSessions("m1");
    expect(data?.[0]).toMatchObject({
      validityMode: "whole_day",
      coveredKind: "day",
      coveredDay: "2026-11-18",
      coveredAttendanceId: null,
      coveredBookingId: null,
    });
  });

  it("maps a consumed visit row with a null coveredDay, as used", async () => {
    sessionRows = [
      row({ consumed_at: ago(1), validity_mode: "single_use", covered_kind: "visit", covered_attendance_id: "a1" }),
    ];
    const { listMemberGuestSessions } = await import("./guestSessions");
    const { data } = await listMemberGuestSessions("m1");
    expect(data).toHaveLength(1);
    expect(data?.[0]).toMatchObject({
      consumedAt: expect.any(String),
      coveredDay: null,
      validityMode: "single_use",
      coveredKind: "visit",
      coveredAttendanceId: "a1",
      coveredBookingId: null,
    });
  });

  it("maps a consumed class row", async () => {
    sessionRows = [row({ consumed_at: ago(1), validity_mode: "single_use", covered_kind: "class", covered_booking_id: "b1" })];
    const { listMemberGuestSessions } = await import("./guestSessions");
    const { data } = await listMemberGuestSessions("m1");
    expect(data?.[0]).toMatchObject({ coveredKind: "class", coveredBookingId: "b1", coveredAttendanceId: null });
  });

  it("an unconsumed row has null cover fields; an unknown code is read as null, not passed through", async () => {
    sessionRows = [row({ id: "u" }), row({ id: "odd", validity_mode: "weekly", covered_kind: "decade" })];
    const { listMemberGuestSessions } = await import("./guestSessions");
    const { data } = await listMemberGuestSessions("m1");
    expect(data?.map((s) => [s.validityMode, s.coveredKind])).toEqual([
      [null, null],
      [null, null],
    ]);
  });
});
