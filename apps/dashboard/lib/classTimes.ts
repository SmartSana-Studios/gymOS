import type { ClassSlot } from "@gymos/types";

/**
 * Story 29.2 (FR-244, UX AD-18 / AD-19): pure helpers for a recurring class's weekly times. A weekday is 0 = Sunday .. 6 = Saturday (Postgres
 * `extract(dow ...)`, what the slot rows store); the screens show the week Monday first, in 24-hour time, in the gym's time zone.
 */

/** Translation key of the short day name, indexed by weekday 0..6. */
export const SHORT_DAY_KEYS = [
  "classes.days.sun",
  "classes.days.mon",
  "classes.days.tue",
  "classes.days.wed",
  "classes.days.thu",
  "classes.days.fri",
  "classes.days.sat",
] as const;

/** Translation key of the full day name, indexed by weekday 0..6 (the editor's Day select). */
export const FULL_DAY_KEYS = [
  "classes.times.dayNames.sun",
  "classes.times.dayNames.mon",
  "classes.times.dayNames.tue",
  "classes.times.dayNames.wed",
  "classes.times.dayNames.thu",
  "classes.times.dayNames.fri",
  "classes.times.dayNames.sat",
] as const;

/** The weekdays in the order the screens show them: Monday first, Sunday last. */
export const MONDAY_FIRST_WEEKDAYS = [1, 2, 3, 4, 5, 6, 0] as const;

/** Position of a weekday in a Monday-first week (Monday 0 .. Sunday 6). */
export function weekPosition(weekday: number): number {
  return (weekday + 6) % 7;
}

/** A slot's sort key: Monday first, then by time; a missing or invalid weekday sorts after every real one. */
export function compareSlots(a: { weekday: number | null; startTime: string }, b: { weekday: number | null; startTime: string }): number {
  const wa = a.weekday === null ? 99 : weekPosition(a.weekday);
  const wb = b.weekday === null ? 99 : weekPosition(b.weekday);
  if (wa !== wb) return wa - wb;
  if (a.startTime === b.startTime) return 0;
  if (a.startTime === "") return 1;
  if (b.startTime === "") return -1;
  return a.startTime < b.startTime ? -1 : 1;
}

export function sortSlots(slots: readonly ClassSlot[]): ClassSlot[] {
  return [...slots].sort(compareSlots);
}

export interface SlotGroup {
  /** Weekdays that share the start time, Monday first. */
  weekdays: number[];
  startTime: string;
}

/** Groups the slots that share a start time, groups ordered by their first slot in the Monday-first week ("Tue, Thu 18:00 · Sat 09:00"). */
export function groupSlots(slots: readonly ClassSlot[]): SlotGroup[] {
  const groups: SlotGroup[] = [];
  for (const slot of sortSlots(slots)) {
    const group = groups.find((g) => g.startTime === slot.startTime);
    if (group) {
      group.weekdays.push(slot.weekday);
    } else {
      groups.push({ weekdays: [slot.weekday], startTime: slot.startTime });
    }
  }
  return groups;
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

export const SUMMARY_GROUP_SEPARATOR = " · ";
const MAX_VISIBLE_GROUPS = 3;

function groupText(group: SlotGroup, t: Translate): string {
  return t("classes.recurringSummary", {
    days: group.weekdays.map((d) => t(SHORT_DAY_KEYS[d])).join(", "),
    time: group.startTime,
  });
}

/**
 * The Schedule column text for a recurring class: groups of days that share an hour, Monday first, three groups and then "+N more". `full` is
 * every group (the tooltip, and the result view's summary line); `truncated` says the visible text is shorter than `full`.
 */
export function summarizeSlots(slots: readonly ClassSlot[], t: Translate): { text: string; full: string; truncated: boolean } {
  const groups = groupSlots(slots);
  const full = groups.map((g) => groupText(g, t)).join(SUMMARY_GROUP_SEPARATOR);
  if (groups.length <= MAX_VISIBLE_GROUPS) {
    return { text: full, full, truncated: false };
  }
  const visible = groups.slice(0, MAX_VISIBLE_GROUPS).map((g) => groupText(g, t)).join(SUMMARY_GROUP_SEPARATOR);
  const more = t("classes.times.summary.more", { n: groups.length - MAX_VISIBLE_GROUPS });
  return { text: `${visible}${SUMMARY_GROUP_SEPARATOR}${more}`, full, truncated: true };
}
