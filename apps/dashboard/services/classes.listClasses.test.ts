/**
 * Story 29.2 (review pass 2): `listClasses()` derives three things the Classes page and the Cancel class dialog read, none of them visible in
 * the component tests (which hand-build their rows):
 *  - the sessions fetch skips a cancelled session (`cancelled_at is null`), so a cancelled session never becomes a class's next session;
 *  - `upcomingBookingCount` adds the bookings of sessions that start AFTER now only -- exactly what `cancel_class` counts -- while the grace
 *    window still lets a session that has just started be the next session;
 *  - `nextSessionMatchesSlots` is null once the next session has started, and otherwise what `class_sessions_with_match` says;
 *  - `class_schedule_slots` rows become `slots` with the time cut to HH:MM.
 * The query builder is a recording stub: each table answers its own canned result, and every call is appended to `calls`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Call = [string, ...unknown[]];

let calls: Call[];
let results: Record<string, { data: unknown; error: unknown }>;
let claimsResult: { data: { claims: Record<string, unknown> | null } | null; error: unknown };

function makeBuilder(table: string) {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "is", "in", "gte", "lt", "order"]) {
    builder[method] = (...args: unknown[]) => {
      calls.push([`${table}.${method}`, ...args]);
      return builder;
    };
  }
  builder.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
    Promise.resolve(results[table]).then(resolve, reject);
  return builder;
}

const from = vi.fn((table: string) => makeBuilder(table));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getClaims: vi.fn(async () => claimsResult) },
    from,
  })),
}));

vi.mock("@/services/session", () => ({
  mapAndLog: vi.fn(async () => ({ code: "unknown", message: "mapped error" })),
}));

vi.mock("@/lib/i18n/get-request-locale", () => ({
  getRequestLocale: vi.fn(async () => "en"),
}));

vi.mock("@/lib/i18n/get-server-translation", () => ({
  getServerTranslation: vi.fn(async () => ({ t: (key: string) => key })),
}));

import { listClasses } from "./classes";

const HOUR = 60 * 60 * 1000;
const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

function classRow(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    name: id.toUpperCase(),
    description: null,
    coach_id: "coach-1",
    capacity: 10,
    schedule_type: "recurring",
    one_off_session_at: null,
    recurrence_start_date: "2026-11-01",
    cancelled_at: null,
    members: { name: "Coach One" },
    class_schedule_slots: [{ weekday: 1, start_time: "07:00:00" }, { weekday: 3, start_time: "18:30:00" }],
    ...extra,
  };
}

const sessionRow = (id: string, classId: string, scheduledAt: string, bookings: number | null) => ({
  id,
  class_id: classId,
  scheduled_at: scheduledAt,
  class_bookings: bookings === null ? null : [{ count: bookings }],
});

describe("listClasses", () => {
  beforeEach(() => {
    calls = [];
    claimsResult = { data: { claims: { gym_id: "gym-1" } }, error: null };
    results = {
      classes: { data: [classRow("c1")], error: null },
      class_sessions: { data: [], error: null },
      class_bookings: { data: [], error: null },
      class_sessions_with_match: { data: [], error: null },
    };
    from.mockClear();
  });

  it("fetches only sessions that are not cancelled, gym-scoped, from the grace window onward", async () => {
    await listClasses();

    const sessionCalls = calls.filter(([name]) => name.startsWith("class_sessions."));
    expect(sessionCalls).toContainEqual(["class_sessions.is", "cancelled_at", null]);
    expect(sessionCalls).toContainEqual(["class_sessions.eq", "gym_id", "gym-1"]);
    expect(sessionCalls.some(([name, column]) => name === "class_sessions.gte" && column === "scheduled_at")).toBe(true);
  });

  it("maps the slots with the time cut to HH:MM and the coach name from the embed", async () => {
    const result = await listClasses();

    expect(result.data?.[0].slots).toEqual([
      { weekday: 1, startTime: "07:00" },
      { weekday: 3, startTime: "18:30" },
    ]);
    expect(result.data?.[0].coachName).toBe("Coach One");
  });

  it("counts bookings only on sessions that start after now (what cancel_class counts), not on one that has just started", async () => {
    results.class_sessions = {
      data: [
        sessionRow("started", "c1", iso(-1 * HOUR), 5),
        sessionRow("soon", "c1", iso(2 * HOUR), 3),
        sessionRow("later", "c1", iso(26 * HOUR), 4),
      ],
      error: null,
    };

    const result = await listClasses();

    expect(result.data?.[0].upcomingBookingCount).toBe(7);
    // The session that has just started is still the class's next session (the grace window), so staff can mark its attendance.
    expect(result.data?.[0].nextSessionId).toBe("started");
  });

  it("counts zero for a class with no upcoming session, and reads a null booking embed as zero", async () => {
    results.classes = { data: [classRow("c1"), classRow("c2")], error: null };
    results.class_sessions = { data: [sessionRow("s1", "c2", iso(3 * HOUR), null)], error: null };

    const result = await listClasses();

    expect(result.data?.map((c) => c.upcomingBookingCount)).toEqual([0, 0]);
  });

  it("nextSessionMatchesSlots is null once the next session has started, and otherwise what the view says", async () => {
    results.classes = { data: [classRow("c1"), classRow("c2"), classRow("c3")], error: null };
    results.class_sessions = {
      data: [
        sessionRow("s-started", "c1", iso(-1 * HOUR), 1),
        sessionRow("s-old-time", "c2", iso(5 * HOUR), 1),
        sessionRow("s-no-row", "c3", iso(6 * HOUR), 0),
      ],
      error: null,
    };
    results.class_sessions_with_match = {
      data: [
        { class_session_id: "s-started", matches_slots: false },
        { class_session_id: "s-old-time", matches_slots: false },
      ],
      error: null,
    };

    const result = await listClasses();

    expect(result.data?.map((c) => c.nextSessionMatchesSlots)).toEqual([null, false, null]);
  });

  it("returns a mapped error with null data when the sessions fetch fails", async () => {
    results.class_sessions = { data: null, error: { message: "boom" } };

    await expect(listClasses()).resolves.toEqual({ data: null, error: { code: "unknown", message: "mapped error" } });
  });
});
