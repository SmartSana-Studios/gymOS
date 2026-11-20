import { describe, expect, it } from "vitest";

import { isAtRowLimit, nextRowAfter, normalizeTime, rowsToSlots, sortRows, validateRows, type TimeRow } from "./weeklyRows";

const row = (key: string, weekday: string, time: string): TimeRow => ({ key, weekday, time });

describe("normalizeTime", () => {
  it.each([
    ["7:05", "07:05"],
    ["07:05", "07:05"],
    ["23:59", "23:59"],
    ["00:00", "00:00"],
    ["730", "07:30"],
    ["1830", "18:30"],
    ["0700", "07:00"],
    ["2359", "23:59"],
  ])("%s becomes %s", (raw, expected) => expect(normalizeTime(raw)).toBe(expected));

  it.each(["", "24:00", "12:60", "7", "7pm", "12:5", "12:30:00", "12345", "2400", "1260", "75", "-730"])("%j is not a time", (raw) => expect(normalizeTime(raw)).toBeNull());
});

describe("sortRows", () => {
  it("sorts Monday first and keeps the array when nothing moves", () => {
    const sorted = [row("a", "1", "07:00"), row("b", "3", "18:00")];
    expect(sortRows(sorted)).toBe(sorted);
    expect(sortRows([row("b", "0", "09:00"), row("a", "1", "07:00")]).map((r) => r.key)).toEqual(["a", "b"]);
  });
});

describe("nextRowAfter", () => {
  it("is the next weekday at the last row's time, Sunday after Saturday and Monday after Sunday", () => {
    expect(nextRowAfter([row("a", "2", "18:00")], "n")).toEqual({ key: "n", weekday: "3", time: "18:00" });
    expect(nextRowAfter([row("a", "6", "18:00")], "n").weekday).toBe("0");
    expect(nextRowAfter([row("a", "0", "18:00")], "n").weekday).toBe("1");
  });
});

describe("validateRows", () => {
  it("flags no row, a missing day, a bad time and a later duplicate", () => {
    expect(validateRows([]).none).toBe(true);
    const v = validateRows([row("a", "1", "07:00"), row("b", "", "07:00"), row("c", "2", "99:99"), row("d", "1", "7:00")]);
    expect(v.rows.a).toBeUndefined();
    expect(v.rows.b).toEqual({ day: true });
    expect(v.rows.c).toEqual({ time: true });
    expect(v.rows.d).toEqual({ duplicate: true });
    expect(v.hasErrors).toBe(true);
  });

  it("accepts the same weekday at two times", () => {
    expect(validateRows([row("a", "1", "07:00"), row("b", "1", "19:00")]).hasErrors).toBe(false);
  });
});

describe("rows", () => {
  it("rowsToSlots sorts and normalizes", () => {
    expect(rowsToSlots([row("b", "0", "9:00"), row("a", "1", "07:00")])).toEqual([
      { weekday: 1, startTime: "07:00" },
      { weekday: 0, startTime: "09:00" },
    ]);
  });

  it("the limit is 14", () => {
    expect(isAtRowLimit(Array.from({ length: 13 }, (_, i) => row(String(i), "1", "07:00")))).toBe(false);
    expect(isAtRowLimit(Array.from({ length: 14 }, (_, i) => row(String(i), "1", "07:00")))).toBe(true);
  });
});
