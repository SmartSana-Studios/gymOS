/**
 * Story 28.3: listMemberGuestSessions reads a class row's name and start through the booking embed and the gym's timezone through the gym
 * embed (object or array shape); listPaidGuestSessions maps the four cover columns and the gym timezone of the Paid tab RPC.
 * guestSessions.test.ts and guestSessions.cover.test.ts run unchanged beside this file.
 */
import { describe, expect, it, vi } from "vitest";

let sessionRows: unknown[] = [];
let lastSelect = "";
let rpcRows: unknown[] = [];

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
    rpc: async () => ({ data: rpcRows, error: null }),
  })),
}));
vi.mock("@/services/session", () => ({ mapAndLog: vi.fn(async () => ({ code: "unknown", message: "m" })) }));
vi.mock("@/lib/i18n/get-request-locale", () => ({ getRequestLocale: vi.fn(async () => "en") }));
vi.mock("@/lib/i18n/get-server-translation", () => ({
  getServerTranslation: vi.fn(async () => ({ t: (k: string) => k })),
}));

const day = 86_400_000;
const row = (o: Record<string, unknown>) => ({
  id: "s",
  payment_id: "p1",
  loyalty_grant_id: null,
  created_at: new Date(Date.now() - day).toISOString(),
  usable_until: new Date(Date.now() + 5 * day).toISOString(),
  consumed_at: null,
  covered_day: null,
  validity_mode: null,
  covered_kind: null,
  covered_attendance_id: null,
  covered_booking_id: null,
  voided_at: null,
  payments: { method: "cash", actor_id: null },
  class_bookings: null,
  gyms: { timezone: "Africa/Douala" },
  ...o,
});

describe("listMemberGuestSessions class cover", () => {
  it("selects the booking embed down to the class name and the gym timezone", async () => {
    sessionRows = [];
    const { listMemberGuestSessions } = await import("./guestSessions");
    await listMemberGuestSessions("m1");
    expect(lastSelect).toContain("class_bookings(class_sessions(scheduled_at, classes(name)))");
    expect(lastSelect).toContain("gyms(timezone)");
  });

  it("maps a class row's name and start, object embeds", async () => {
    sessionRows = [
      row({
        consumed_at: new Date().toISOString(),
        validity_mode: "single_use",
        covered_kind: "class",
        covered_booking_id: "b1",
        class_bookings: { class_sessions: { scheduled_at: "2026-11-20T17:00:00Z", classes: { name: "Yoga" } } },
      }),
    ];
    const { listMemberGuestSessions } = await import("./guestSessions");
    const { data } = await listMemberGuestSessions("m1");
    expect(data?.[0]).toMatchObject({ coveredKind: "class", className: "Yoga", classStartsAt: "2026-11-20T17:00:00Z", gymTimezone: "Africa/Douala" });
  });

  it("maps array-shaped embeds, and a null embed (booking gone) to nulls without throwing", async () => {
    sessionRows = [
      row({
        id: "a",
        consumed_at: new Date().toISOString(),
        validity_mode: "single_use",
        covered_kind: "class",
        covered_booking_id: "b1",
        class_bookings: [{ class_sessions: [{ scheduled_at: "2026-11-20T17:00:00Z", classes: [{ name: "Pilates" }] }] }],
        gyms: [{ timezone: "Africa/Douala" }],
      }),
      row({ id: "b", consumed_at: new Date().toISOString(), validity_mode: "single_use", covered_kind: "class", covered_booking_id: null, gyms: null }),
    ];
    const { listMemberGuestSessions } = await import("./guestSessions");
    const { data } = await listMemberGuestSessions("m1");
    const byId = Object.fromEntries((data ?? []).map((s) => [s.id, s]));
    expect(byId.a).toMatchObject({ className: "Pilates", classStartsAt: "2026-11-20T17:00:00Z", gymTimezone: "Africa/Douala" });
    expect(byId.b).toMatchObject({ className: null, classStartsAt: null, gymTimezone: null });
  });
});

describe("listPaidGuestSessions cover columns", () => {
  it("maps covered_kind, covered_booking_id, class_name, class_starts_at and gym_timezone, and defaults them to null", async () => {
    rpcRows = [
      {
        payment_id: "p1", member_id: "m1", member_name: "A", amount: 2000, method: "cash", created_at: "2026-11-01T00:00:00Z", consumed_at: "2026-11-02T00:00:00Z",
        refund_state: "none", recorder_id: null, recorder_name: null, recorder_kind: "unknown", group_sessions: null, group_total: null, total_count: 2,
        covered_kind: "class", covered_booking_id: "b1", class_name: "Yoga", class_starts_at: "2026-11-02T10:00:00Z", gym_timezone: "Africa/Douala",
      },
      {
        payment_id: "p2", member_id: "m2", member_name: "B", amount: 2000, method: "cash", created_at: "2026-11-01T00:00:00Z", consumed_at: null,
        refund_state: "none", recorder_id: null, recorder_name: null, recorder_kind: "unknown", group_sessions: null, group_total: null, total_count: 2,
      },
    ];
    const { listPaidGuestSessions } = await import("./guestSessions");
    const { data } = await listPaidGuestSessions({ period: "month", page: 1 });
    expect(data?.rows[0]).toMatchObject({ coveredKind: "class", coveredBookingId: "b1", className: "Yoga", classStartsAt: "2026-11-02T10:00:00Z", gymTimezone: "Africa/Douala" });
    expect(data?.rows[1]).toMatchObject({ coveredKind: null, coveredBookingId: null, className: null, classStartsAt: null, gymTimezone: null });
  });
});
