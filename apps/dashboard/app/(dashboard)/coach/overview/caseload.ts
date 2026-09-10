import type { CoachClassRow } from "@/services/classes";
import type { CoachMemberRecencyRow } from "@/services/coaches";
import { gymLocalDaysAgo } from "../gymTime";

/**
 * Story 17.5 (AC #4, #6, #7, #9): what the Coach Portal Overview's list
 * widgets show, as pure functions of the reads and one `now` the page takes
 * once per render. Nothing here reads the clock.
 *
 * These constants are the ONLY place the thresholds live: the selectors use
 * them, and the page interpolates the same values into the widgets' copy, so
 * the rule and the words describing it cannot drift apart.
 */

// AD-20's mockup shows three upcoming sessions; "All →" leads to the rest.
export const NEXT_SESSIONS_LIMIT = 3;

// Decided with the product owner, 2026-09-10. Two weeks without a written note
// tolerates one missed weekly check-in before a member is flagged, so the
// widget surfaces real neglect rather than a normal gap between sessions.
export const FOLLOW_UP_AFTER_DAYS = 14;

// Decided with the product owner, 2026-09-10. "Recent" means this week: a
// member on a weekly weigh-in cadence appears once per entry.
export const RECENT_PROGRESS_WITHIN_DAYS = 7;

// Rows shown per member widget before "+N more"; keeps the four-card grid even.
export const WIDGET_MAX_ROWS = 5;

/** One upcoming session of one of the Coach's classes, with what a My Next
 * Sessions row renders. */
export interface NextSession {
  classId: string;
  className: string;
  classSessionId: string;
  scheduledAt: string;
  bookedCount: number;
  capacity: number;
  gymTimezone: string;
}

/** A member widget's rows, and how many more matched than it shows. */
export interface CaseloadSelection<Row extends CoachMemberRecencyRow = CoachMemberRecencyRow> {
  rows: Row[];
  moreCount: number;
}

/** A member with a recorded latest activity. */
export type CoachMemberWithActivity = CoachMemberRecencyRow & { lastAt: string };

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function byName(a: CoachMemberRecencyRow, b: CoachMemberRecencyRow): number {
  return a.memberName.localeCompare(b.memberName) || compareText(a.memberId, b.memberId);
}

function cap<Row extends CoachMemberRecencyRow>(rows: Row[]): CaseloadSelection<Row> {
  return { rows: rows.slice(0, WIDGET_MAX_ROWS), moreCount: Math.max(0, rows.length - WIDGET_MAX_ROWS) };
}

/** AC #4: every class's sessions strictly after `now`, soonest first (ties by
 * class name, then class id), at most NEXT_SESSIONS_LIMIT. `listMyClasses()`
 * returns sessions from gym-local midnight, so today's earlier sessions arrive
 * here and are dropped. Compared as instants, never as strings. */
export function selectNextSessions(classes: CoachClassRow[], now: Date): NextSession[] {
  const nowMs = now.getTime();

  return classes
    .flatMap((cls) =>
      cls.sessions
        .filter((session) => Date.parse(session.scheduledAt) > nowMs)
        .map((session) => ({
          classId: cls.classId,
          className: cls.className,
          classSessionId: session.classSessionId,
          scheduledAt: session.scheduledAt,
          bookedCount: session.bookedCount,
          capacity: cls.capacity,
          gymTimezone: cls.gymTimezone,
        })),
    )
    .sort(
      (a, b) =>
        Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt) ||
        a.className.localeCompare(b.className) ||
        compareText(a.classId, b.classId),
    )
    .slice(0, NEXT_SESSIONS_LIMIT);
}

/** AC #6: members with no note from this Coach, or none for
 * FOLLOW_UP_AFTER_DAYS or more gym-local calendar days. Never-noted members
 * come first (by name), then the longest silence first (ties by name). */
export function selectFollowUp(rows: CoachMemberRecencyRow[], now: Date): CaseloadSelection {
  const flagged = rows.filter(
    (row) => row.lastAt === null || gymLocalDaysAgo(row.lastAt, now, row.gymTimezone) >= FOLLOW_UP_AFTER_DAYS,
  );

  flagged.sort((a, b) => {
    if (a.lastAt === null || b.lastAt === null) {
      if (a.lastAt === b.lastAt) return byName(a, b);
      return a.lastAt === null ? -1 : 1;
    }
    return Date.parse(a.lastAt) - Date.parse(b.lastAt) || byName(a, b);
  });

  return cap(flagged);
}

/** AC #7: members whose latest active entry is within the last
 * RECENT_PROGRESS_WITHIN_DAYS gym-local calendar days (a future-dated entry
 * counts as today), most recent first (ties by name). */
export function selectRecentProgress(
  rows: CoachMemberRecencyRow[],
  now: Date,
): CaseloadSelection<CoachMemberWithActivity> {
  const recent = rows.filter(
    (row): row is CoachMemberWithActivity =>
      row.lastAt !== null && gymLocalDaysAgo(row.lastAt, now, row.gymTimezone) < RECENT_PROGRESS_WITHIN_DAYS,
  );

  recent.sort((a, b) => Date.parse(b.lastAt) - Date.parse(a.lastAt) || byName(a, b));

  return cap(recent);
}
