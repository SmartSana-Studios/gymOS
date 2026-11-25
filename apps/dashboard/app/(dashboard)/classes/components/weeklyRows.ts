import { MAX_CLASS_SLOTS, type ClassSlot } from "@gymos/types";

import { compareSlots } from "@/lib/classTimes";

/**
 * Story 29.2 (UX AD-19): the weekly-times editor's row model and its pure rules. A row holds what the person typed: `weekday` is "" (none
 * chosen) or "0".."6" (Sunday .. Saturday, the storage convention, never shown) and `time` is the raw text of the Time field.
 */
export interface TimeRow {
  key: string;
  weekday: string;
  time: string;
}

export interface RowErrors {
  day?: boolean;
  time?: boolean;
  duplicate?: boolean;
}

export interface RowsValidation {
  /** No row at all: "Add at least one day and time." */
  none: boolean;
  rows: Record<string, RowErrors>;
  /** Any problem at all. */
  hasErrors: boolean;
}

/** "7:00" and "07:00" become "07:00"; so do the digits alone ("700", "0700"), which is all a phone's numeric keypad can type. Anything that is
 * not a valid 24-hour time to the minute is null. */
export function normalizeTime(raw: string): string | null {
  const m = /^\s*(\d{1,2}):(\d{2})\s*$/.exec(raw) ?? /^\s*(\d{1,2})(\d{2})\s*$/.exec(raw);
  if (!m) return null;
  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  if (hours > 23 || minutes > 59) return null;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function parseWeekday(raw: string): number | null {
  if (raw === "") return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 && n <= 6 ? n : null;
}

function rowSortKey(row: TimeRow) {
  return { weekday: parseWeekday(row.weekday), startTime: normalizeTime(row.time) ?? row.time };
}

/** Rows in week order, Monday first, then by time. Stable: equal rows keep their order. Returns the same array when nothing moved. */
export function sortRows(rows: TimeRow[]): TimeRow[] {
  const sorted = [...rows].sort((a, b) => compareSlots(rowSortKey(a), rowSortKey(b)));
  return sorted.every((row, i) => row === rows[i]) ? rows : sorted;
}

/** The row [+ Add a time] appends: the weekday after the last row's (Sunday follows Saturday) and the same time. */
export function nextRowAfter(rows: TimeRow[], key: string): TimeRow {
  const last = rows[rows.length - 1];
  const lastDay = last ? parseWeekday(last.weekday) : null;
  return {
    key,
    weekday: lastDay === null ? "1" : String((lastDay + 1) % 7),
    time: last ? last.time : "",
  };
}

export function isAtRowLimit(rows: TimeRow[]): boolean {
  return rows.length >= MAX_CLASS_SLOTS;
}

/** Per-row problems: no day, an invalid time, and a day and time already listed by an EARLIER row (the later row is the one flagged). */
export function validateRows(rows: TimeRow[]): RowsValidation {
  const result: RowsValidation = { none: rows.length === 0, rows: {}, hasErrors: rows.length === 0 };
  const seen = new Set<string>();
  for (const row of rows) {
    const errors: RowErrors = {};
    const day = parseWeekday(row.weekday);
    const time = normalizeTime(row.time);
    if (day === null) errors.day = true;
    if (time === null) errors.time = true;
    if (day !== null && time !== null) {
      const id = `${day}|${time}`;
      if (seen.has(id)) errors.duplicate = true;
      seen.add(id);
    }
    if (errors.day || errors.time || errors.duplicate) {
      result.rows[row.key] = errors;
      result.hasErrors = true;
    }
  }
  return result;
}

/** The slots to send, in week order. Call only after `validateRows` found no error. */
export function rowsToSlots(rows: TimeRow[]): ClassSlot[] {
  return sortRows(rows).map((row) => ({
    weekday: Number(row.weekday),
    startTime: normalizeTime(row.time) ?? row.time,
  }));
}

/** One row per stored slot, in week order: a migrated class opens as one row per old day at its old hour. */
export function rowsFromSlots(slots: readonly ClassSlot[], makeKey: () => string): TimeRow[] {
  return [...slots]
    .sort(compareSlots)
    .map((slot) => ({ key: makeKey(), weekday: String(slot.weekday), time: slot.startTime.slice(0, 5) }));
}
