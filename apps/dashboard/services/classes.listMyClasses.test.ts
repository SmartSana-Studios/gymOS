/**
 * Story 17.4 (Task 3, AC #7): `listMyClasses()` is a thin wrapper over the
 * `list_my_classes()` RPC (0096). Who may see which rows is decided in SQL and
 * proven in supabase/tests/coach_portal_my_classes.test.sql; this pins the
 * service contract `/coach/classes` renders from:
 *  - the RPC is called with NO arguments -- the Coach is resolved server-side,
 *    never from a client-supplied coach id;
 *  - one row per (class, session) is grouped into one entry per class, in the
 *    SQL's own order;
 *  - the left join's null-session row becomes a class with no sessions;
 *  - booked_count (a bigint) always becomes a number;
 *  - zero rows is an empty list, not an error -- a non-coach caller gets zero
 *    rows by design;
 *  - a failure is a mapped `{ data: null, error }`, never a throw.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = {
  class_id: string;
  class_name: string;
  capacity: number;
  schedule_type: string;
  one_off_session_at: string | null;
  slots: { weekday: number; start_time: string }[];
  cancelled_at: string | null;
  gym_timezone: string;
  class_session_id: string | null;
  scheduled_at: string | null;
  booked_count: number | string;
  matches_slots?: boolean | null;
};

type ClassColumns = Omit<Row, "class_session_id" | "scheduled_at" | "booked_count">;

let rpcResult: { data: Row[] | null; error: unknown };
const rpc = vi.fn<(fn: string, args?: unknown) => Promise<typeof rpcResult>>(async () => rpcResult);

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ rpc })),
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

import { listMyClasses } from "./classes";

const WORKSHOP: ClassColumns = {
  class_id: "class-workshop",
  class_name: "Archived Workshop",
  capacity: 10,
  schedule_type: "one_off",
  one_off_session_at: "2026-08-31T09:00:00+00:00",
  slots: [],
  cancelled_at: null,
  gym_timezone: "Africa/Douala",
};

const HIIT: ClassColumns = {
  class_id: "class-hiit",
  class_name: "HIIT Circuit",
  capacity: 15,
  schedule_type: "recurring",
  one_off_session_at: null,
  slots: [
    { weekday: 1, start_time: "18:00" },
    { weekday: 3, start_time: "18:00" },
    { weekday: 5, start_time: "18:00" },
  ],
  cancelled_at: null,
  gym_timezone: "Africa/Douala",
};

const YOGA: ClassColumns = {
  class_id: "class-yoga",
  class_name: "Morning Yoga",
  capacity: 12,
  schedule_type: "recurring",
  one_off_session_at: null,
  slots: [
    { weekday: 2, start_time: "07:00" },
    { weekday: 4, start_time: "07:00" },
  ],
  cancelled_at: null,
  gym_timezone: "Africa/Douala",
};

function sessionRow(base: ClassColumns, sessionId: string | null, scheduledAt: string | null, booked: number | string): Row {
  return {
    ...base,
    slots: base.slots.map((s) => ({ ...s })),
    class_session_id: sessionId,
    scheduled_at: scheduledAt,
    booked_count: booked,
  };
}

describe("listMyClasses", () => {
  beforeEach(() => {
    rpc.mockClear();
  });

  it("calls list_my_classes with no arguments -- the coach is never passed from the client", async () => {
    rpcResult = { data: [], error: null };

    await listMyClasses();

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0]).toEqual(["list_my_classes"]);
  });

  it("groups session rows into one entry per class, preserving the SQL order", async () => {
    rpcResult = {
      data: [
        sessionRow(WORKSHOP, null, null, 0),
        sessionRow(HIIT, "session-1", "2026-09-09T23:00:00+00:00", 1),
        sessionRow(HIIT, "session-2", "2026-09-11T17:00:00+00:00", 3),
        sessionRow(YOGA, "session-3", "2026-09-15T06:00:00+00:00", 0),
        sessionRow(YOGA, "session-4", "2026-09-17T06:00:00+00:00", 2),
      ],
      error: null,
    };

    await expect(listMyClasses()).resolves.toEqual({
      data: [
        {
          classId: "class-workshop",
          className: "Archived Workshop",
          capacity: 10,
          scheduleType: "one_off",
          oneOffSessionAt: "2026-08-31T09:00:00+00:00",
          slots: [],
          cancelledAt: null,
          gymTimezone: "Africa/Douala",
          sessions: [],
        },
        {
          classId: "class-hiit",
          className: "HIIT Circuit",
          capacity: 15,
          scheduleType: "recurring",
          oneOffSessionAt: null,
          slots: [
            { weekday: 1, startTime: "18:00" },
            { weekday: 3, startTime: "18:00" },
            { weekday: 5, startTime: "18:00" },
          ],
          cancelledAt: null,
          gymTimezone: "Africa/Douala",
          sessions: [
            { classSessionId: "session-1", scheduledAt: "2026-09-09T23:00:00+00:00", bookedCount: 1, matchesSlots: true },
            { classSessionId: "session-2", scheduledAt: "2026-09-11T17:00:00+00:00", bookedCount: 3, matchesSlots: true },
          ],
        },
        {
          classId: "class-yoga",
          className: "Morning Yoga",
          capacity: 12,
          scheduleType: "recurring",
          oneOffSessionAt: null,
          slots: [
            { weekday: 2, startTime: "07:00" },
            { weekday: 4, startTime: "07:00" },
          ],
          cancelledAt: null,
          gymTimezone: "Africa/Douala",
          sessions: [
            { classSessionId: "session-3", scheduledAt: "2026-09-15T06:00:00+00:00", bookedCount: 0, matchesSlots: true },
            { classSessionId: "session-4", scheduledAt: "2026-09-17T06:00:00+00:00", bookedCount: 2, matchesSlots: true },
          ],
        },
      ],
      error: null,
    });
  });

  it("turns the left join's null-session row into a class with no sessions", async () => {
    rpcResult = { data: [sessionRow(WORKSHOP, null, null, 0)], error: null };

    const result = await listMyClasses();

    expect(result.data).toHaveLength(1);
    expect(result.data?.[0].sessions).toEqual([]);
  });

  it("always returns booked counts as numbers, even when the bigint arrives as a string", async () => {
    rpcResult = { data: [sessionRow(HIIT, "session-1", "2026-09-11T17:00:00+00:00", "12")], error: null };

    const result = await listMyClasses();

    expect(result.data?.[0].sessions[0].bookedCount).toBe(12);
  });

  it("reads slots, cancelled_at and a per-session matches_slots (Story 29.2)", async () => {
    rpcResult = {
      data: [
        { ...sessionRow({ ...HIIT, cancelled_at: "2026-09-10T09:00:00+00:00" }, "session-1", "2026-09-11T17:00:00+00:00", 2), matches_slots: false },
        { ...sessionRow({ ...HIIT, cancelled_at: "2026-09-10T09:00:00+00:00" }, "session-2", "2026-09-13T17:00:00+00:00", 0), matches_slots: true },
      ],
      error: null,
    };

    const result = await listMyClasses();

    expect(result.data?.[0].cancelledAt).toBe("2026-09-10T09:00:00+00:00");
    expect(result.data?.[0].slots).toEqual([
      { weekday: 1, startTime: "18:00" },
      { weekday: 3, startTime: "18:00" },
      { weekday: 5, startTime: "18:00" },
    ]);
    expect(result.data?.[0].sessions.map((s) => s.matchesSlots)).toEqual([false, true]);
  });

  it("returns an empty list, not an error, for zero rows", async () => {
    rpcResult = { data: [], error: null };

    await expect(listMyClasses()).resolves.toEqual({ data: [], error: null });
  });

  it("treats a null result like zero rows", async () => {
    rpcResult = { data: null, error: null };

    await expect(listMyClasses()).resolves.toEqual({ data: [], error: null });
  });

  it("returns a mapped error with null data instead of throwing", async () => {
    rpcResult = { data: null, error: { message: "list_my_classes: gym x is not active" } };

    await expect(listMyClasses()).resolves.toEqual({
      data: null,
      error: { code: "unknown", message: "mapped error" },
    });
  });
});
