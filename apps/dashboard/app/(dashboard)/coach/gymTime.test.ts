/**
 * Story 17.5 (AC #9): the Coach Portal's gym-local time helpers.
 *
 *  - `gymLocalDaysAgo()` counts gym-local CALENDAR days, not elapsed 24-hour
 *    periods, in the gym's own timezone -- never UTC or the runtime's -- and
 *    clamps a future instant (a fast device clock on an offline progress
 *    entry) to 0;
 *  - `relativeDaysFormatter()` phrases a day count in the viewer's locale;
 *  - `gymDateFormatter()` (moved here from coach/classes/page.tsx) formats in
 *    the gym's zone. Its year rule stays pinned by coach/classes/page.test.tsx.
 */
import { describe, expect, it } from "vitest";

import { gymDateFormatter, gymLocalDaysAgo, relativeDaysFormatter } from "./gymTime";

const NOW = new Date("2026-09-10T08:00:00Z"); // 09:00 in Africa/Douala (UTC+1)

describe("gymLocalDaysAgo", () => {
  it("uses the gym's timezone: 23:30 UTC yesterday is already today in Douala", () => {
    expect(gymLocalDaysAgo("2026-09-09T23:30:00Z", NOW, "Africa/Douala")).toBe(0);
    expect(gymLocalDaysAgo("2026-09-09T23:30:00Z", NOW, "UTC")).toBe(1);
  });

  it("counts calendar days, not elapsed 24-hour periods: 22:30 yesterday is one day ago at 09:00", () => {
    expect(gymLocalDaysAgo("2026-09-09T21:30:00Z", NOW, "Africa/Douala")).toBe(1);
  });

  it("counts across a month boundary", () => {
    expect(gymLocalDaysAgo("2026-08-21T10:00:00Z", NOW, "Africa/Douala")).toBe(20);
    expect(gymLocalDaysAgo("2026-08-31T12:00:00Z", NOW, "Africa/Douala")).toBe(10);
  });

  it("decides the year in the gym's timezone: 23:30 UTC on 31 December is New Year's Day in Douala", () => {
    const newYearsMorning = new Date("2026-01-01T09:00:00Z");

    expect(gymLocalDaysAgo("2025-12-31T23:30:00Z", newYearsMorning, "Africa/Douala")).toBe(0);
    expect(gymLocalDaysAgo("2025-12-31T23:30:00Z", newYearsMorning, "UTC")).toBe(1);
  });

  it("clamps an instant in the future to 0", () => {
    expect(gymLocalDaysAgo("2026-09-12T10:00:00Z", NOW, "Africa/Douala")).toBe(0);
  });
});

describe("relativeDaysFormatter", () => {
  it("phrases day counts in English, with today and yesterday as words", () => {
    const format = relativeDaysFormatter("en");

    expect(format(0)).toBe("today");
    expect(format(1)).toBe("yesterday");
    expect(format(21)).toBe("21 days ago");
  });

  it("phrases day counts in French", () => {
    const format = relativeDaysFormatter("fr");

    expect(format(1)).toBe("hier");
    expect(format(21)).toContain("21");
    expect(format(21)).toContain("il y a");
  });
});

describe("gymDateFormatter", () => {
  it("formats an instant 24-hour in the gym's timezone, not the runtime's", () => {
    expect(gymDateFormatter("en", "Africa/Douala")("2026-09-11T17:00:00Z")).toContain("18:00");
    expect(gymDateFormatter("en", "UTC")("2026-09-11T17:00:00Z")).toContain("17:00");
  });
});
