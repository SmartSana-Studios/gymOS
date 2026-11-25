import { describe, expect, it } from "vitest";

import { classSchema } from "./class";

const base = {
  name: "Pilates",
  coachId: "coach-1",
  capacity: 12,
  scheduleType: "recurring" as const,
  oneOffSessionAt: null,
  recurrenceStartDate: "2026-12-01",
};

describe("classSchema (Story 29.2)", () => {
  it("accepts a recurring class with per-day times", () => {
    const r = classSchema.safeParse({ ...base, slots: [{ weekday: 1, startTime: "07:00" }, { weekday: 1, startTime: "19:00" }, { weekday: 6, startTime: "09:00" }] });
    expect(r.success).toBe(true);
  });

  it("refuses a recurring class with no slot, more than 14, a duplicate, or a bad time", () => {
    expect(classSchema.safeParse({ ...base, slots: [] }).success).toBe(false);
    expect(classSchema.safeParse({ ...base, slots: null }).success).toBe(false);
    const fifteen = Array.from({ length: 15 }, (_, i) => ({ weekday: i % 7, startTime: `0${i % 10}:${i < 7 ? "00" : "30"}` }));
    expect(classSchema.safeParse({ ...base, slots: fifteen }).success).toBe(false);
    expect(classSchema.safeParse({ ...base, slots: [{ weekday: 1, startTime: "07:00" }, { weekday: 1, startTime: "07:00" }] }).success).toBe(false);
    expect(classSchema.safeParse({ ...base, slots: [{ weekday: 1, startTime: "7:00" }] }).success).toBe(false);
    expect(classSchema.safeParse({ ...base, slots: [{ weekday: 7, startTime: "07:00" }] }).success).toBe(false);
  });

  it("accepts exactly 14", () => {
    const fourteen = Array.from({ length: 14 }, (_, i) => ({ weekday: i % 7, startTime: i < 7 ? "06:00" : "18:00" }));
    expect(classSchema.safeParse({ ...base, slots: fourteen }).success).toBe(true);
  });

  it("a one-off class needs a date and no slots", () => {
    const oneOff = { ...base, scheduleType: "one_off" as const, oneOffSessionAt: "2026-12-05T10:00:00.000Z", recurrenceStartDate: null };
    expect(classSchema.safeParse({ ...oneOff, slots: null }).success).toBe(true);
    expect(classSchema.safeParse({ ...oneOff, slots: [{ weekday: 1, startTime: "07:00" }] }).success).toBe(false);
  });
});
