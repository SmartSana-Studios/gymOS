/**
 * Story 29.2 (FR-244, FR-245; UX AD-18, AD-19): the Schedule column (groups, Monday first, "+N more"), the row actions per role, the Cancelled
 * badge and sorting, the "Old time" tag, the weekly-times editor in the Create/Edit modal (rows, counter, limit, errors, sorting, result view)
 * and the Cancel class dialog.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { ClassRow } from "@/services/classes";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => (opts ? `${key}|${Object.values(opts).join("|")}` : key),
    i18n: { language: "en" },
  }),
}));

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const createClass = vi.fn();
const editClass = vi.fn();
const cancelClassAction = vi.fn();
vi.mock("../actions", () => ({
  markAttendanceAction: vi.fn(),
  getSessionBookingsAction: vi.fn(async () => ({ data: [], error: null })),
  createClass: (...a: unknown[]) => createClass(...a),
  editClass: (...a: unknown[]) => editClass(...a),
  cancelClassAction: (...a: unknown[]) => cancelClassAction(...a),
}));
vi.mock("@/components/shared/RecordSessionPaymentDialog", () => ({ RecordSessionPaymentDialog: () => null }));

import { ClassesPageClient } from "./ClassesPageClient";

const MON = 1;
const TUE = 2;
const WED = 3;
const THU = 4;
const SAT = 6;
const SUN = 0;

function recurring(id: string, name: string, slots: [number, string][], extra: Partial<ClassRow> = {}): ClassRow {
  return {
    id,
    name,
    description: null,
    coachId: "coach-1",
    coachName: "Coach One",
    capacity: 15,
    scheduleType: "recurring",
    oneOffSessionAt: null,
    slots: slots.map(([weekday, startTime]) => ({ weekday, startTime })),
    recurrenceStartDate: "2026-11-01",
    cancelledAt: null,
    upcomingBookingCount: 0,
    nextSessionMatchesSlots: null,
    nextSessionAt: null,
    nextSessionId: null,
    bookedCount: 0,
    ...extra,
  };
}

function oneOff(id: string, name: string): ClassRow {
  return recurring(id, name, [], { scheduleType: "one_off", oneOffSessionAt: "2026-12-05T10:00:00.000Z", recurrenceStartDate: null });
}

function renderPage(classes: ClassRow[], role: "manager" | "receptionist" | "owner" | "supervisor" | "coach" = "manager") {
  return render(<ClassesPageClient initialClasses={classes} coaches={[{ id: "coach-1", name: "Coach One" } as never]} role={role} gymTimezone="Africa/Douala" />);
}

function rowOf(name: string): HTMLElement {
  return screen.getByText(name).closest("tr") as HTMLElement;
}

const group = (days: string[], time: string) => `classes.recurringSummary|${days.map((d) => `classes.days.${d}`).join(", ")}|${time}`;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Schedule column", () => {
  it("one group: days that share an hour, Monday first", () => {
    renderPage([recurring("c1", "ONE", [[THU, "18:00"], [TUE, "18:00"]])]);
    expect(within(rowOf("ONE")).getByText(group(["tue", "thu"], "18:00"))).toBeInTheDocument();
  });

  it("three groups, joined, in week order starting Monday (Sunday last)", () => {
    renderPage([recurring("c3", "THREE", [[SAT, "09:00"], [SUN, "20:00"], [MON, "07:00"], [WED, "18:30"]].slice(0, 3) as [number, string][])]);
    const text = within(rowOf("THREE")).getByText(/classes\.recurringSummary/).textContent;
    expect(text).toBe([group(["mon"], "07:00"), group(["sat"], "09:00"), group(["sun"], "20:00")].join(" · "));
  });

  it("two groups where the first shares days: 'Tue, Thu 18:00 · Sat 09:00'", () => {
    renderPage([recurring("c2", "TWO", [[SAT, "09:00"], [TUE, "18:00"], [THU, "18:00"]])]);
    expect(within(rowOf("TWO")).getByText([group(["tue", "thu"], "18:00"), group(["sat"], "09:00")].join(" · "))).toBeInTheDocument();
  });

  it("four groups: three, then +N more, with the full list in the tooltip", () => {
    renderPage([recurring("c4", "FOUR", [[MON, "07:00"], [TUE, "08:00"], [WED, "09:00"], [THU, "10:00"], [SAT, "11:00"]])]);
    const cell = within(rowOf("FOUR")).getByText(/classes\.times\.summary\.more/);
    expect(cell.textContent).toBe(
      [group(["mon"], "07:00"), group(["tue"], "08:00"), group(["wed"], "09:00"), "classes.times.summary.more|2"].join(" · "),
    );
    expect(cell).toHaveAttribute(
      "title",
      [group(["mon"], "07:00"), group(["tue"], "08:00"), group(["wed"], "09:00"), group(["thu"], "10:00"), group(["sat"], "11:00")].join(" · "),
    );
  });

  it("a one-off class keeps its date", () => {
    renderPage([oneOff("o1", "WORKSHOP")]);
    expect(within(rowOf("WORKSHOP")).queryByText(/classes\.recurringSummary/)).toBeNull();
    expect(within(rowOf("WORKSHOP")).getByText(/2026/)).toBeInTheDocument();
  });

  it("a migrated class reads exactly its old days and hour", () => {
    renderPage([recurring("m1", "MIGRATED", [[TUE, "18:00"], [THU, "18:00"]])]);
    expect(within(rowOf("MIGRATED")).getByText(group(["tue", "thu"], "18:00"))).toBeInTheDocument();
  });
});

describe("row actions and the Cancelled badge", () => {
  const live = recurring("l1", "LIVE", [[MON, "07:00"]]);
  const cancelled = recurring("x1", "CANCELLED", [[MON, "07:00"]], { cancelledAt: "2026-11-15T10:00:00Z" });

  it("a Manager sees Edit and Cancel class on a live class", () => {
    renderPage([live]);
    expect(within(rowOf("LIVE")).getByRole("button", { name: "classes.edit" })).toBeInTheDocument();
    expect(within(rowOf("LIVE")).getByRole("button", { name: "classes.cancel.action" })).toBeInTheDocument();
  });

  it.each(["receptionist", "coach"] as const)("a %s has neither action in the DOM", (role) => {
    renderPage([live], role);
    expect(screen.queryByRole("button", { name: "classes.edit" })).toBeNull();
    expect(screen.queryByRole("button", { name: "classes.cancel.action" })).toBeNull();
  });

  it("a cancelled class shows the neutral badge and offers neither action", () => {
    renderPage([cancelled]);
    expect(within(rowOf("CANCELLED")).getByText("classes.cancel.badge")).toBeInTheDocument();
    expect(within(rowOf("CANCELLED")).queryByRole("button", { name: "classes.edit" })).toBeNull();
    expect(within(rowOf("CANCELLED")).queryByRole("button", { name: "classes.cancel.action" })).toBeNull();
  });

  it("a cancelled class sorts below the live ones, whatever the order it arrived in", () => {
    renderPage([cancelled, live, recurring("l2", "LIVE TWO", [[TUE, "07:00"]])]);
    const names = Array.from(document.querySelectorAll("tbody > tr")).map((r) => r.querySelector("td")?.textContent ?? "");
    expect(names[0]).toBe("LIVE");
    expect(names[1]).toBe("LIVE TWO");
    expect(names[2]).toContain("CANCELLED");
  });
});

describe("the Old time tag", () => {
  const future = "2099-01-01T06:00:00Z";

  it("shows in the expanded row of a booked future session that no longer matches", async () => {
    const user = userEvent.setup();
    renderPage([recurring("o1", "MOVED", [[MON, "07:30"]], { nextSessionId: "s1", nextSessionAt: future, bookedCount: 2, nextSessionMatchesSlots: false })]);
    await user.click(rowOf("MOVED"));
    expect(await screen.findByText("classes.times.oldTimeTag")).toBeInTheDocument();
  });

  it.each([
    ["it matches", { nextSessionMatchesSlots: true, bookedCount: 2 }],
    ["it has no booking", { nextSessionMatchesSlots: false, bookedCount: 0 }],
  ])("is absent when %s", async (_label, extra) => {
    const user = userEvent.setup();
    renderPage([recurring("o2", "FINE", [[MON, "07:30"]], { nextSessionId: "s1", nextSessionAt: future, ...extra })]);
    await user.click(rowOf("FINE"));
    await waitFor(() => expect(screen.queryByText("classes.attendance.loadingBookings")).toBeNull());
    expect(screen.queryByText("classes.times.oldTimeTag")).toBeNull();
  });
});

function dialog(): HTMLDialogElement {
  return document.querySelector("dialog[open]") as HTMLDialogElement;
}

function rowsIn(d: HTMLElement) {
  return {
    days: Array.from(d.querySelectorAll<HTMLSelectElement>("select[id^='weeklyDay-']")),
    times: Array.from(d.querySelectorAll<HTMLInputElement>("input[id^='weeklyTime-']")),
  };
}

describe("the weekly-times editor", () => {
  async function openEdit(cls: ClassRow) {
    const user = userEvent.setup();
    renderPage([cls]);
    await user.click(within(rowOf(cls.name)).getByRole("button", { name: "classes.edit" }));
    return user;
  }

  it("opens a class as one row per time with the counter and the time-zone line", async () => {
    await openEdit(recurring("e1", "EDIT", [[WED, "18:30"], [MON, "07:00"]]));
    const d = within(dialog());
    const { days, times } = rowsIn(dialog());
    expect(days.map((s) => s.value)).toEqual(["1", "3"]);
    expect(times.map((i) => i.value)).toEqual(["07:00", "18:30"]);
    expect(d.getByText("classes.times.counter|2")).toBeInTheDocument();
    expect(d.getByText("classes.times.timezone|Africa/Douala")).toBeInTheDocument();
  });

  it("offers the days Monday first, Sunday last", async () => {
    await openEdit(recurring("e1", "EDIT", [[MON, "07:00"]]));
    const options = Array.from(rowsIn(dialog()).days[0].options).map((o) => o.value);
    expect(options).toEqual(["", "1", "2", "3", "4", "5", "6", "0"]);
  });

  it("shows the edit notice only for a class with upcoming sessions", async () => {
    await openEdit(recurring("e1", "EDIT", [[MON, "07:00"]], { nextSessionId: "s1", nextSessionAt: "2026-12-01T06:00:00Z" }));
    expect(within(dialog()).getByText("classes.times.editNotice")).toBeInTheDocument();
  });

  it("has no edit notice for a class without upcoming sessions", async () => {
    await openEdit(recurring("e1", "EDIT", [[MON, "07:00"]]));
    expect(within(dialog()).queryByText("classes.times.editNotice")).toBeNull();
  });

  it("[+ Add a time] appends the next weekday at the last row's time and moves focus to its Day select", async () => {
    const user = await openEdit(recurring("e1", "EDIT", [[TUE, "18:00"]]));
    await user.click(within(dialog()).getByRole("button", { name: "classes.times.add" }));
    const { days, times } = rowsIn(dialog());
    expect(days.map((s) => s.value)).toEqual(["2", "3"]);
    expect(times.map((i) => i.value)).toEqual(["18:00", "18:00"]);
    expect(days[1]).toHaveFocus();
    expect(within(dialog()).getByText("classes.times.counter|2")).toBeInTheDocument();
  });

  it("at 14 rows [+ Add a time] stays visible, is aria-disabled, adds nothing and shows the limit", async () => {
    const slots: [number, string][] = Array.from({ length: 14 }, (_, i) => [i % 7, `${String(6 + Math.floor(i / 7)).padStart(2, "0")}:00`]);
    const user = await openEdit(recurring("e1", "EDIT", slots));
    const add = within(dialog()).getByRole("button", { name: "classes.times.add" });
    expect(add).toHaveAttribute("aria-disabled", "true");
    expect(within(dialog()).getByText("classes.times.limit")).toBeInTheDocument();
    expect(within(dialog()).getByText("classes.times.counter|14")).toBeInTheDocument();
    await user.click(add);
    expect(rowsIn(dialog()).days).toHaveLength(14);
  });

  it("below 14 rows the add control is not aria-disabled and no limit line shows", async () => {
    await openEdit(recurring("e1", "EDIT", [[MON, "07:00"]]));
    expect(within(dialog()).getByRole("button", { name: "classes.times.add" })).not.toHaveAttribute("aria-disabled");
    expect(within(dialog()).queryByText("classes.times.limit")).toBeNull();
  });

  it("the same weekday may appear twice at different times", async () => {
    const user = await openEdit(recurring("e1", "EDIT", [[MON, "07:00"]]));
    await user.click(within(dialog()).getByRole("button", { name: "classes.times.add" }));
    const { days, times } = rowsIn(dialog());
    await user.selectOptions(days[1], "1");
    await user.clear(times[1]);
    await user.type(times[1], "19:00");
    await user.click(within(dialog()).getByRole("button", { name: "classes.modal.saveChanges" }));
    expect(within(dialog()).queryByText("classes.times.error.duplicate")).toBeNull();
    expect(editClass).toHaveBeenCalled();
  });

  it("an identical day and time on a later row shows the duplicate error inline, with aria-describedby, and an error summary", async () => {
    const user = await openEdit(recurring("e1", "EDIT", [[MON, "07:00"]]));
    await user.click(within(dialog()).getByRole("button", { name: "classes.times.add" }));
    const { days, times } = rowsIn(dialog());
    await user.selectOptions(days[1], "1");
    await user.clear(times[1]);
    await user.type(times[1], "07:00");
    await user.click(within(dialog()).getByRole("button", { name: "classes.modal.saveChanges" }));
    const error = within(dialog()).getByText("classes.times.error.duplicate");
    expect(times[1]).toHaveAttribute("aria-describedby", error.id);
    expect(within(dialog()).getByText("classes.times.error.summary")).toBeInTheDocument();
    expect(editClass).not.toHaveBeenCalled();
  });

  it("a row with no day or no valid time shows its own inline error", async () => {
    const user = await openEdit(recurring("e1", "EDIT", [[MON, "07:00"]]));
    await user.click(within(dialog()).getByRole("button", { name: "classes.times.add" }));
    const { days, times } = rowsIn(dialog());
    await user.selectOptions(days[1], "");
    await user.clear(times[1]);
    await user.type(times[1], "25:99");
    await user.click(within(dialog()).getByRole("button", { name: "classes.modal.saveChanges" }));
    expect(within(dialog()).getByText("classes.times.error.day")).toBeInTheDocument();
    await user.selectOptions(days[1], "3");
    await user.click(within(dialog()).getByRole("button", { name: "classes.modal.saveChanges" }));
    expect(within(dialog()).getByText("classes.times.error.time")).toBeInTheDocument();
    expect(editClass).not.toHaveBeenCalled();
  });

  it("removing the only row is allowed; saving then shows 'add at least one day and time'", async () => {
    const user = await openEdit(recurring("e1", "EDIT", [[MON, "07:00"]]));
    await user.click(within(dialog()).getByRole("button", { name: /classes\.times\.removeAria/ }));
    expect(rowsIn(dialog()).days).toHaveLength(0);
    expect(within(dialog()).getByText("classes.times.counter|0")).toBeInTheDocument();
    await user.click(within(dialog()).getByRole("button", { name: "classes.modal.saveChanges" }));
    expect(within(dialog()).getByText("classes.times.error.none")).toBeInTheDocument();
    expect(editClass).not.toHaveBeenCalled();
  });

  it("a row losing focus re-sorts Monday first and announces it politely", async () => {
    const user = await openEdit(recurring("e1", "EDIT", [[TUE, "18:00"], [WED, "18:00"]]));
    const { days } = rowsIn(dialog());
    await user.selectOptions(days[1], "1");
    expect(rowsIn(dialog()).days.map((s) => s.value)).toEqual(["2", "1"]);
    await user.tab();
    await user.tab();
    await user.tab();
    await waitFor(() => expect(rowsIn(dialog()).days.map((s) => s.value)).toEqual(["1", "2"]));
    const live = within(dialog()).getByText("classes.times.sorted");
    expect(live).toHaveAttribute("aria-live", "polite");
  });

  it("moving between the controls of one row does not re-sort", async () => {
    const user = await openEdit(recurring("e1", "EDIT", [[TUE, "18:00"], [WED, "18:00"]]));
    const { days, times } = rowsIn(dialog());
    await user.selectOptions(days[1], "1");
    days[1].focus();
    await user.tab();
    expect(times[1]).toHaveFocus();
    expect(rowsIn(dialog()).days.map((s) => s.value)).toEqual(["2", "1"]);
  });

  it("tidies 7:05 to 07:05 on blur", async () => {
    const user = await openEdit(recurring("e1", "EDIT", [[MON, "07:00"]]));
    const { times } = rowsIn(dialog());
    await user.clear(times[0]);
    await user.type(times[0], "7:05");
    await user.tab();
    await user.tab();
    await waitFor(() => expect(rowsIn(dialog()).times[0].value).toBe("07:05"));
  });

  it("keeps what was entered for the other mode when switching One-off and Recurring", async () => {
    const user = await openEdit(recurring("e1", "EDIT", [[MON, "07:00"], [WED, "18:30"]]));
    await user.click(within(dialog()).getByLabelText("classes.modal.oneOff"));
    expect(rowsIn(dialog()).days).toHaveLength(0);
    await user.click(within(dialog()).getByLabelText("classes.modal.recurring"));
    expect(rowsIn(dialog()).days.map((s) => s.value)).toEqual(["1", "3"]);
    expect(rowsIn(dialog()).times.map((i) => i.value)).toEqual(["07:00", "18:30"]);
  });

  it("sends the slots in week order on save and creates without a result view", async () => {
    createClass.mockResolvedValue({ data: { id: "new" }, error: null });
    const user = userEvent.setup();
    renderPage([]);
    await user.click(screen.getAllByRole("button", { name: /classes\.addClass/ })[0]);
    const d = dialog();
    await user.type(d.querySelector<HTMLInputElement>("#className") as HTMLInputElement, "Pilates");
    await user.selectOptions(d.querySelector("#classCoach") as HTMLSelectElement, "coach-1");
    await user.type(d.querySelector<HTMLInputElement>("#classCapacity") as HTMLInputElement, "12");
    await user.click(within(d).getByLabelText("classes.modal.recurring"));
    fireEvent.change(d.querySelector("#recurrenceStartDate") as HTMLInputElement, { target: { value: "2026-12-01" } });
    const first = rowsIn(d);
    await user.selectOptions(first.days[0], "6");
    await user.type(first.times[0], "09:00");
    await user.click(within(d).getByRole("button", { name: "classes.times.add" }));
    const second = rowsIn(d);
    await user.selectOptions(second.days[1], "1");
    await user.clear(second.times[1]);
    await user.type(second.times[1], "07:00");
    await user.click(within(d).getByRole("button", { name: "classes.addClassButton" }));
    await waitFor(() => expect(createClass).toHaveBeenCalledTimes(1));
    expect(createClass.mock.calls[0][0]).toMatchObject({
      scheduleType: "recurring",
      slots: [
        { weekday: 1, startTime: "07:00" },
        { weekday: 6, startTime: "09:00" },
      ],
      recurrenceStartDate: "2026-12-01",
    });
    expect(createClass.mock.calls[0][0]).not.toHaveProperty("recurrenceDays");
    expect(screen.queryByTestId("class-saved-result")).toBeNull();
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });
});

describe("the result view after an edit", () => {
  async function saveEdit(leftUnchanged: { classSessionId: string; scheduledAt: string; bookedCount: number; capacity: number }[]) {
    editClass.mockResolvedValue({ data: { id: "e1", leftUnchanged }, error: null });
    const user = userEvent.setup();
    renderPage([recurring("e1", "EDIT", [[MON, "07:00"]])]);
    const editButton = within(rowOf("EDIT")).getByRole("button", { name: "classes.edit" });
    await user.click(editButton);
    await user.click(within(dialog()).getByRole("button", { name: "classes.modal.saveChanges" }));
    return { user, editButton };
  }

  it("lists the sessions left unchanged with n / capacity booked, read-only, focus on the heading", async () => {
    await saveEdit([
      { classSessionId: "s1", scheduledAt: "2026-11-23T06:00:00+00:00", bookedCount: 8, capacity: 15 },
      { classSessionId: "s2", scheduledAt: "2026-11-30T06:00:00+00:00", bookedCount: 12, capacity: 15 },
    ]);
    const d = within(dialog());
    const heading = await d.findByRole("heading", { name: "classes.times.saved.title" });
    expect(heading).toHaveFocus();
    expect(d.getByText("classes.times.saved.summary|" + group(["mon"], "07:00"))).toBeInTheDocument();
    expect(d.getByText("classes.times.left.title|2")).toBeInTheDocument();
    expect(d.getByText("classes.times.left.help")).toBeInTheDocument();
    const items = d.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain("|8|15");
    expect(items[0].textContent).toContain("07:00");
    expect(items[1].textContent).toContain("|12|15");
    expect(d.queryByRole("textbox")).toBeNull();
    expect(d.getByRole("button", { name: "classes.times.done" })).toBeInTheDocument();
  });

  it("uses the singular title for one session", async () => {
    await saveEdit([{ classSessionId: "s1", scheduledAt: "2026-11-23T06:00:00+00:00", bookedCount: 1, capacity: 15 }]);
    expect(await within(dialog()).findByText("classes.times.left.title1")).toBeInTheDocument();
  });

  it("says nothing was left unchanged when the list is empty", async () => {
    await saveEdit([]);
    expect(await within(dialog()).findByText("classes.times.left.none")).toBeInTheDocument();
  });

  it("[Done] refreshes the list and returns focus to the class's Edit button", async () => {
    const { user, editButton } = await saveEdit([]);
    await user.click(await within(dialog()).findByRole("button", { name: "classes.times.done" }));
    expect(refresh).toHaveBeenCalled();
    await waitFor(() => expect(editButton).toHaveFocus());
  });
});

describe("the Cancel class dialog", () => {
  const withBookings = recurring("b1", "PILATES", [[MON, "07:00"]], { upcomingBookingCount: 8 });
  const empty = recurring("b2", "EMPTY", [[MON, "07:00"]], { upcomingBookingCount: 0 });

  async function openCancel(cls: ClassRow) {
    const user = userEvent.setup();
    renderPage([cls]);
    await user.click(within(rowOf(cls.name)).getByRole("button", { name: "classes.cancel.action" }));
    return user;
  }

  it("shows the title, the count of bookings, and the action-named buttons", async () => {
    await openCancel(withBookings);
    const d = within(dialog());
    expect(d.getByRole("heading", { name: "classes.cancel.title|PILATES" })).toBeInTheDocument();
    expect(d.getByText("classes.cancel.body|8")).toBeInTheDocument();
    expect(d.getByRole("button", { name: "classes.cancel.keep" })).toBeInTheDocument();
    expect(d.getByRole("button", { name: "classes.cancel.action" })).toBeInTheDocument();
    expect(d.queryByRole("button", { name: "common.cancel" })).toBeNull();
  });

  it("uses the separate copy when nobody has booked", async () => {
    await openCancel(empty);
    expect(within(dialog()).getByText("classes.cancel.bodyNoBookings")).toBeInTheDocument();
    expect(within(dialog()).queryByText(/classes\.cancel\.body\|/)).toBeNull();
  });

  it("Escape is disabled", async () => {
    await openCancel(withBookings);
    const event = new Event("cancel", { cancelable: true });
    act(() => {
      dialog().dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(true);
  });

  it("[Keep class] closes without cancelling", async () => {
    const user = await openCancel(withBookings);
    await user.click(within(dialog()).getByRole("button", { name: "classes.cancel.keep" }));
    expect(cancelClassAction).not.toHaveBeenCalled();
    await waitFor(() => expect(document.querySelector("dialog[open]")).toBeNull());
  });

  it("confirming cancels, shows the success toast and refreshes", async () => {
    cancelClassAction.mockResolvedValue({ data: { bookingsCancelled: 8 }, error: null });
    const user = await openCancel(withBookings);
    await user.click(within(dialog()).getByRole("button", { name: "classes.cancel.action" }));
    expect(cancelClassAction).toHaveBeenCalledWith("b1");
    expect(await screen.findByText("classes.cancel.toast|PILATES")).toBeInTheDocument();
    expect(refresh).toHaveBeenCalled();
  });

  it("an already-cancelled class shows its own message and no second confirm", async () => {
    cancelClassAction.mockResolvedValue({ data: null, error: { code: "class_already_cancelled", message: "classes.cancel.already" } });
    const user = await openCancel(withBookings);
    await user.click(within(dialog()).getByRole("button", { name: "classes.cancel.action" }));
    expect(await within(dialog()).findByText("classes.cancel.already")).toBeInTheDocument();
    expect(within(dialog()).queryByRole("button", { name: "classes.cancel.action" })).toBeNull();
  });

  it("any other failure shows the generic error and keeps the confirm available", async () => {
    cancelClassAction.mockResolvedValue({ data: null, error: { code: "class_cancel_failed", message: "classes.cancel.error" } });
    const user = await openCancel(withBookings);
    await user.click(within(dialog()).getByRole("button", { name: "classes.cancel.action" }));
    expect(await within(dialog()).findByText("classes.cancel.error")).toBeInTheDocument();
    expect(within(dialog()).getByRole("button", { name: "classes.cancel.action" })).toBeInTheDocument();
  });
});
