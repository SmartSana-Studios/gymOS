/**
 * Story 17.5 (AC #4, #6, #7, #9, #15): the Coach Portal Overview's pure
 * selectors and the constants that define them.
 *
 *  - My Next Sessions: strictly after `now` (17.4's window starts at gym-local
 *    midnight, so earlier-today sessions arrive and must go), across classes,
 *    soonest first, three at most;
 *  - Needs Follow-Up: no note from this Coach, or none for 14+ gym-local
 *    calendar days; never-noted first, then the longest silence; five rows
 *    plus a count of the rest;
 *  - Recent Progress: latest entry within the last 7 gym-local calendar days,
 *    most recent first; five rows plus a count of the rest.
 */
import { describe, expect, it } from "vitest";

import type { CoachClassRow } from "@/services/classes";
import type { CoachMemberRecencyRow } from "@/services/coaches";
import {
  FOLLOW_UP_AFTER_DAYS,
  NEXT_SESSIONS_LIMIT,
  RECENT_PROGRESS_WITHIN_DAYS,
  WIDGET_MAX_ROWS,
  selectFollowUp,
  selectNextSessions,
  selectRecentProgress,
} from "./caseload";

const NOW = new Date("2026-09-10T08:00:00Z"); // 09:00 in Africa/Douala
const TZ = "Africa/Douala";

/** Local noon in Douala, `n` gym-local calendar days before NOW's date. */
function daysAgo(n: number): string {
  return new Date(Date.UTC(2026, 8, 10 - n, 11, 0, 0)).toISOString();
}

function classRow(classId: string, className: string, sessions: [string, string, number][]): CoachClassRow {
  return {
    classId,
    className,
    capacity: 15,
    scheduleType: "recurring",
    oneOffSessionAt: null,
    recurrenceDays: [1, 3, 5],
    recurrenceTime: "18:00:00",
    gymTimezone: TZ,
    sessions: sessions.map(([classSessionId, scheduledAt, bookedCount]) => ({ classSessionId, scheduledAt, bookedCount })),
  };
}

function member(memberId: string, memberName: string, lastAt: string | null, gymTimezone = TZ): CoachMemberRecencyRow {
  return { memberId, memberName, gymTimezone, lastAt };
}

describe("caseload constants", () => {
  it("pins the product owner's thresholds and the widget sizes", () => {
    expect(FOLLOW_UP_AFTER_DAYS).toBe(14);
    expect(RECENT_PROGRESS_WITHIN_DAYS).toBe(7);
    expect(NEXT_SESSIONS_LIMIT).toBe(3);
    expect(WIDGET_MAX_ROWS).toBe(5);
  });
});

describe("selectNextSessions", () => {
  it("keeps only sessions strictly after now: earlier today and exactly now are dropped", () => {
    const classes = [
      classRow("c-hiit", "HIIT", [
        ["s-earlier-today", "2026-09-10T06:00:00Z", 2],
        ["s-now", NOW.toISOString(), 3],
        ["s-next-minute", "2026-09-10T08:01:00Z", 4],
      ]),
    ];

    expect(selectNextSessions(classes, NOW).map((s) => s.classSessionId)).toEqual(["s-next-minute"]);
  });

  it("merges every class's sessions, soonest first, capped at three, with what a row needs", () => {
    const classes = [
      classRow("c-hiit", "HIIT", [
        ["s-hiit-fri", "2026-09-11T17:00:00Z", 8],
        ["s-hiit-mon", "2026-09-14T17:00:00Z", 5],
      ]),
      classRow("c-yoga", "Yoga", [
        ["s-yoga-thu", "2026-09-10T17:00:00Z", 11],
        ["s-yoga-tue", "2026-09-15T06:00:00Z", 1],
      ]),
      classRow("c-empty", "Workshop", []),
    ];

    const sessions = selectNextSessions(classes, NOW);

    expect(sessions).toHaveLength(3);
    expect(sessions.map((s) => s.classSessionId)).toEqual(["s-yoga-thu", "s-hiit-fri", "s-hiit-mon"]);
    expect(sessions[0]).toEqual({
      classId: "c-yoga",
      className: "Yoga",
      classSessionId: "s-yoga-thu",
      scheduledAt: "2026-09-10T17:00:00Z",
      bookedCount: 11,
      capacity: 15,
      gymTimezone: TZ,
    });
  });

  it("breaks a tie on time by class name, then class id", () => {
    const at = "2026-09-11T17:00:00Z";
    const classes = [
      classRow("c-2", "Zumba", [["s-zumba", at, 0]]),
      classRow("c-b", "Boxing", [["s-boxing-b", at, 0]]),
      classRow("c-a", "Boxing", [["s-boxing-a", at, 0]]),
    ];

    expect(selectNextSessions(classes, NOW).map((s) => s.classSessionId)).toEqual(["s-boxing-a", "s-boxing-b", "s-zumba"]);
  });

  it("returns nothing when no session is upcoming", () => {
    expect(selectNextSessions([], NOW)).toEqual([]);
    expect(selectNextSessions([classRow("c-empty", "Workshop", [])], NOW)).toEqual([]);
  });
});

describe("selectFollowUp", () => {
  it("flags a member at 14 gym-local days without a note, not at 13, and always one with no note", () => {
    const rows = [member("m-13", "Thirteen", daysAgo(13)), member("m-14", "Fourteen", daysAgo(14)), member("m-none", "Never", null)];

    expect(selectFollowUp(rows, NOW).rows.map((r) => r.memberId)).toEqual(["m-none", "m-14"]);
  });

  it("counts days on the gym's calendar, not UTC's", () => {
    // 23:30 UTC on 27 August is 00:30 on 28 August in Douala: 13 days there, 14 in UTC.
    const lateNight = "2026-08-27T23:30:00Z";

    expect(selectFollowUp([member("m-1", "Aicha", lateNight, "Africa/Douala")], NOW).rows).toEqual([]);
    expect(selectFollowUp([member("m-1", "Aicha", lateNight, "UTC")], NOW).rows).toHaveLength(1);
  });

  it("does not flag a note dated in the future", () => {
    expect(selectFollowUp([member("m-1", "Aicha", "2026-09-12T10:00:00Z")], NOW).rows).toEqual([]);
  });

  it("lists never-noted members first by name, then the longest silence first, ties by name", () => {
    const rows = [
      member("m-rose", "Rose", null),
      member("m-blaise", "Blaise", daysAgo(20)),
      member("m-olivier", "Olivier", daysAgo(14)),
      member("m-marc", "Marc", null),
      member("m-alain", "Alain", daysAgo(14)),
    ];

    expect(selectFollowUp(rows, NOW).rows.map((r) => r.memberId)).toEqual(["m-marc", "m-rose", "m-blaise", "m-alain", "m-olivier"]);
  });

  it("caps the list at five and counts the rest", () => {
    const rows = Array.from({ length: 7 }, (_, i) => member(`m-${i}`, `Member ${i}`, null));

    const { rows: shown, moreCount } = selectFollowUp(rows, NOW);

    expect(shown).toHaveLength(5);
    expect(moreCount).toBe(2);
  });

  it("returns an empty list and no remainder when everyone has a recent note", () => {
    expect(selectFollowUp([member("m-1", "Aicha", daysAgo(3))], NOW)).toEqual({ rows: [], moreCount: 0 });
  });
});

describe("selectRecentProgress", () => {
  it("keeps an entry from 6 gym-local days ago, drops one from 7, and drops members with none", () => {
    const rows = [member("m-6", "Six", daysAgo(6)), member("m-7", "Seven", daysAgo(7)), member("m-none", "Never", null)];

    expect(selectRecentProgress(rows, NOW).rows.map((r) => r.memberId)).toEqual(["m-6"]);
  });

  it("keeps an entry dated in the future, counted as today", () => {
    expect(selectRecentProgress([member("m-1", "Aicha", "2026-09-12T10:00:00Z")], NOW).rows).toHaveLength(1);
  });

  it("lists the most recent first, ties by name", () => {
    const rows = [
      member("m-blaise", "Blaise", daysAgo(5)),
      member("m-aicha", "Aicha", daysAgo(2)),
      member("m-zoe", "Zoe", daysAgo(2)),
      member("m-carine", "Carine", daysAgo(2)),
    ];

    expect(selectRecentProgress(rows, NOW).rows.map((r) => r.memberId)).toEqual(["m-aicha", "m-carine", "m-zoe", "m-blaise"]);
  });

  it("caps the list at five and counts the rest", () => {
    const rows = Array.from({ length: 6 }, (_, i) => member(`m-${i}`, `Member ${i}`, daysAgo(1)));

    const { rows: shown, moreCount } = selectRecentProgress(rows, NOW);

    expect(shown).toHaveLength(5);
    expect(moreCount).toBe(1);
  });
});
