/* eslint-disable i18next/no-literal-string -- test doubles render fixed marker text; no user-facing copy */
/**
 * Story 29.1 (FR-245): no screen changes. The recurring class's times are stored as slot rows server side, but this screen still reads
 * recurrenceDays and recurrenceTime. For fixture classes the Schedule column and the Create/Edit modal show exactly the days and the time
 * they showed before the migration (the "HH:mm:ss" Postgres time included), for a migrated class and a class created afterwards alike.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { ClassRow } from "@/services/classes";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, string>) => (opts ? `${key}|${Object.values(opts).join("|")}` : key),
    i18n: { language: "en" },
  }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("../actions", () => ({
  markAttendanceAction: vi.fn(),
  getSessionBookingsAction: vi.fn(),
  createClass: vi.fn(),
  editClass: vi.fn(),
}));
vi.mock("@/components/shared/RecordSessionPaymentDialog", () => ({ RecordSessionPaymentDialog: () => null }));

import { ClassesPageClient } from "./ClassesPageClient";

function recurring(id: string, name: string, days: number[], time: string, start: string): ClassRow {
  return {
    id,
    name,
    description: null,
    coachId: "coach-1",
    coachName: "Coach One",
    capacity: 12,
    scheduleType: "recurring",
    oneOffSessionAt: null,
    recurrenceDays: days,
    recurrenceTime: time,
    recurrenceStartDate: start,
    nextSessionAt: null,
    nextSessionId: null,
    bookedCount: 0,
  } as ClassRow;
}

// The fixtures of the migration test: a Tue/Thu class, a Sunday-only class (weekday 0), a daily class, a class with a past start date.
const FIXTURES: { cls: ClassRow; days: string[]; time: string }[] = [
  { cls: recurring("c-tt", "TUE THU", [2, 4], "18:00:00", "2026-11-01"), days: ["classes.days.tue", "classes.days.thu"], time: "18:00" },
  { cls: recurring("c-sun", "SUNDAY ONLY", [0], "09:30:00", "2026-11-01"), days: ["classes.days.sun"], time: "09:30" },
  {
    cls: recurring("c-daily", "DAILY", [0, 1, 2, 3, 4, 5, 6], "07:00:00", "2026-11-01"),
    days: ["classes.days.sun", "classes.days.mon", "classes.days.tue", "classes.days.wed", "classes.days.thu", "classes.days.fri", "classes.days.sat"],
    time: "07:00",
  },
  { cls: recurring("c-past", "PAST START", [1, 3, 5], "18:15:00", "2026-06-01"), days: ["classes.days.mon", "classes.days.wed", "classes.days.fri"], time: "18:15" },
];

const ALL_DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"].map((d) => `classes.days.${d}`);

describe("ClassesPageClient and ClassModal read the recurring schedule exactly as before the slots migration", () => {
  it("shows each fixture class's days and 24-hour time in the Schedule column", () => {
    render(<ClassesPageClient initialClasses={FIXTURES.map((f) => f.cls)} coaches={[]} role="manager" />);

    for (const { cls, days, time } of FIXTURES) {
      const row = screen.getByText(cls.name).closest("tr") as HTMLElement;
      expect(within(row).getByText(`classes.recurringSummary|${days.join(", ")}|${time}`)).toBeInTheDocument();
    }
  });

  it.each(FIXTURES)("opens the edit modal for $cls.name with the same days, time and start date", async ({ cls, days, time }) => {
    const user = userEvent.setup();
    render(<ClassesPageClient initialClasses={[cls]} coaches={[]} role="manager" />);

    await user.click(screen.getByRole("button", { name: "classes.edit" }));

    const dialog = document.querySelector("dialog") as HTMLDialogElement;
    const modal = within(dialog);
    expect(modal.getByLabelText("classes.modal.recurring")).toBeChecked();
    for (const key of ALL_DAY_KEYS) {
      const box = modal.getByLabelText(key);
      if (days.includes(key)) expect(box).toBeChecked();
      else expect(box).not.toBeChecked();
    }
    expect(dialog.querySelector<HTMLInputElement>("#recurrenceTime")?.value).toBe(time);
    expect(dialog.querySelector<HTMLInputElement>("#recurrenceStartDate")?.value).toBe(cls.recurrenceStartDate);
  });
});
