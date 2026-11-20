import { describe, expect, it } from "vitest";

import { groupSlots, sortSlots, summarizeSlots } from "./classTimes";

const t = (key: string, opts?: Record<string, unknown>) => (opts ? `${key}|${Object.values(opts).join("|")}` : key);
const s = (weekday: number, startTime: string) => ({ weekday, startTime });

describe("sortSlots", () => {
  it("orders the week Monday first, Sunday last, then by time", () => {
    expect(sortSlots([s(0, "09:00"), s(3, "18:00"), s(1, "19:00"), s(1, "07:00")])).toEqual([s(1, "07:00"), s(1, "19:00"), s(3, "18:00"), s(0, "09:00")]);
  });
});

describe("groupSlots", () => {
  it("groups the days that share an hour; groups follow their first slot in the week", () => {
    expect(groupSlots([s(6, "09:00"), s(4, "18:00"), s(2, "18:00")])).toEqual([
      { weekdays: [2, 4], startTime: "18:00" },
      { weekdays: [6], startTime: "09:00" },
    ]);
  });

  it("keeps the same weekday at two times as two groups", () => {
    expect(groupSlots([s(1, "07:00"), s(1, "19:00")])).toHaveLength(2);
  });
});

describe("summarizeSlots", () => {
  it("shows up to three groups in full", () => {
    const r = summarizeSlots([s(1, "07:00"), s(3, "18:30"), s(6, "09:00")], t);
    expect(r.truncated).toBe(false);
    expect(r.text).toBe(r.full);
    expect(r.text.split(" · ")).toHaveLength(3);
  });

  it("truncates four groups to three plus +N more, the full list kept for the tooltip", () => {
    const r = summarizeSlots([s(1, "07:00"), s(2, "08:00"), s(3, "09:00"), s(4, "10:00"), s(5, "11:00")], t);
    expect(r.truncated).toBe(true);
    expect(r.text.split(" · ")).toHaveLength(4);
    expect(r.text.endsWith("classes.times.summary.more|2")).toBe(true);
    expect(r.full.split(" · ")).toHaveLength(5);
  });
});
