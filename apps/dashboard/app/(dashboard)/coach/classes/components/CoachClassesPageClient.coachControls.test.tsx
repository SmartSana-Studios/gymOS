/**
 * Story 29.3 (UX AD-21 V1.8, AD-19 Coach mode, AD-18 cancel dialog): a Coach creates, edits and cancels their own classes from My Classes.
 *
 *  - [+ Create class] on the page and in the empty state, [Edit] and [Cancel class] on each live class, beside (never inside) the row's
 *    disclosure button, absent for a cancelled class;
 *  - without the signed-in `coach` (another role, the read-only picker) none of those controls exist;
 *  - the modal opens in Coach mode: Coach is plain text (no select), the id sent is the server-resolved one, the weekly-times editor and the
 *    result view are 29.2's;
 *  - the Cancel dialog shows the server-resolved booking count; a refusal for a class that is not theirs shows classes.coach.ownOnly and
 *    refreshes the list;
 *  - roster and attendance stay read-only: no checkbox, no mark control, no booking add or remove in the DOM.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
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
vi.mock("../../../classes/actions", () => ({
  createClass: (...a: unknown[]) => createClass(...a),
  editClass: (...a: unknown[]) => editClass(...a),
  cancelClassAction: (...a: unknown[]) => cancelClassAction(...a),
}));

const getMySessionRosterAction = vi.fn();
vi.mock("../actions", () => ({ getMySessionRosterAction: (id: string) => getMySessionRosterAction(id) }));

import { CoachClassesPageClient, type CoachClassView } from "./CoachClassesPageClient";

const COACH = { id: "coach-1", name: "Coach One" };

function editRow(id: string, extra: Partial<ClassRow> = {}): ClassRow {
  return {
    id,
    name: id.toUpperCase(),
    description: "Evening burn",
    coachId: COACH.id,
    coachName: COACH.name,
    capacity: 15,
    scheduleType: "recurring",
    oneOffSessionAt: null,
    slots: [
      { weekday: 1, startTime: "07:00" },
      { weekday: 4, startTime: "18:30" },
    ],
    recurrenceStartDate: "2026-11-01",
    cancelledAt: null,
    upcomingBookingCount: 5,
    nextSessionMatchesSlots: true,
    nextSessionAt: "2026-11-23T06:00:00Z",
    nextSessionId: "session-1",
    bookedCount: 3,
    ...extra,
  };
}

function view(id: string, extra: Partial<CoachClassView> = {}, row: Partial<ClassRow> = {}): CoachClassView {
  return {
    classId: id,
    className: id.toUpperCase(),
    scheduleLabel: "Mon 07:00",
    capacityLabel: "Capacity 15",
    editRow: editRow(id, row),
    sessions: [{ classSessionId: "session-1", label: "Mon 23 Nov", bookedLabel: "3/15 booked" }],
    ...extra,
  };
}

const LIVE = view("hiit");
const CANCELLED = view("old", { cancelledLabel: "classes.cancel.badge" }, { cancelledAt: "2026-11-01T00:00:00Z" });

function dialog(): HTMLDialogElement {
  return document.querySelector("dialog[open]") as HTMLDialogElement;
}

function rowsIn(d: HTMLElement) {
  return {
    days: Array.from(d.querySelectorAll<HTMLSelectElement>("select[id^='weeklyDay-']")),
    times: Array.from(d.querySelectorAll<HTMLInputElement>("input[id^='weeklyTime-']")),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getMySessionRosterAction.mockResolvedValue({ data: [{ memberId: "m1", memberName: "Alice", attendedAt: null }], error: null });
});

describe("the controls", () => {
  it("shows [+ Create class] on the page and [Edit] and [Cancel class] on a live class, beside the disclosure button", () => {
    render(<CoachClassesPageClient classes={[LIVE]} coach={COACH} gymTimezone="Africa/Douala" />);

    expect(screen.getByRole("button", { name: "classes.coach.create" })).toBeInTheDocument();
    const section = document.getElementById("class-hiit") as HTMLElement;
    const edit = within(section).getByRole("button", { name: "classes.edit" });
    const cancel = within(section).getByRole("button", { name: "classes.cancel.action" });
    const heading = within(section).getByRole("heading", { level: 2 });
    expect(heading.contains(edit)).toBe(false);
    expect(heading.contains(cancel)).toBe(false);
    expect(within(heading).getByRole("button", { expanded: false })).toBeInTheDocument();
  });

  it("offers no [Edit] or [Cancel class] on a cancelled class, which keeps its badge", () => {
    render(<CoachClassesPageClient classes={[LIVE, CANCELLED]} coach={COACH} />);

    const section = document.getElementById("class-old") as HTMLElement;
    expect(within(section).getByText("classes.cancel.badge")).toBeInTheDocument();
    expect(within(section).queryByRole("button", { name: "classes.edit" })).toBeNull();
    expect(within(section).queryByRole("button", { name: "classes.cancel.action" })).toBeNull();
    expect(screen.getAllByRole("button", { name: "classes.edit" })).toHaveLength(1);
  });

  it("without the signed-in Coach there is no control at all: every button is a disclosure", () => {
    render(<CoachClassesPageClient classes={[LIVE]} />);

    expect(screen.queryByRole("button", { name: "classes.coach.create" })).toBeNull();
    expect(screen.queryByRole("button", { name: "classes.edit" })).toBeNull();
    expect(screen.queryByRole("button", { name: "classes.cancel.action" })).toBeNull();
    for (const button of screen.getAllByRole("button")) expect(button).toHaveAttribute("aria-expanded");
  });

  it("the empty state for a Coach is classes.coach.empty with [+ Create class]", () => {
    render(<CoachClassesPageClient classes={[]} coach={COACH} />);

    expect(screen.getByText("classes.coach.empty")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "classes.coach.create" })).toHaveLength(1);
  });

  it("the empty state for any other reader is the old line, with no button", () => {
    render(<CoachClassesPageClient classes={[]} />);

    expect(screen.getByText("coachPortal.classes.emptyNoClasses")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("keeps roster and attendance read-only: an expanded roster has no checkbox, no mark control and no booking add or remove", async () => {
    const user = userEvent.setup();
    render(<CoachClassesPageClient classes={[LIVE]} coach={COACH} />);

    await user.click(screen.getByRole("button", { name: /HIIT/ }));
    await user.click(screen.getByRole("button", { name: /Mon 23 Nov/ }));
    await screen.findByText("Alice");

    const section = document.getElementById("class-hiit") as HTMLElement;
    expect(section.querySelector("input[type='checkbox']")).toBeNull();
    expect(section.querySelector("input, select, textarea, form, a")).toBeNull();
    for (const button of within(section).getAllByRole("button")) {
      const isDisclosure = button.hasAttribute("aria-expanded");
      const isOwnClassAction = button.textContent === "classes.edit" || button.textContent === "classes.cancel.action";
      expect(isDisclosure || isOwnClassAction, button.textContent ?? "").toBe(true);
    }
  });
});

describe("the modal in Coach mode", () => {
  it("[+ Create class] opens it with Coach as plain text, not a select, and sends the server-resolved Coach id", async () => {
    createClass.mockResolvedValue({ data: { id: "new" }, error: null });
    const user = userEvent.setup();
    render(<CoachClassesPageClient classes={[]} coach={COACH} gymTimezone="Africa/Douala" />);

    await user.click(screen.getByRole("button", { name: "classes.coach.create" }));
    const d = dialog();
    expect(d.querySelector("select#classCoach")).toBeNull();
    expect(within(d).getByTestId("class-coach-fixed")).toHaveTextContent("Coach One");
    expect(within(d).getByText("classes.coach.fixed")).toBeInTheDocument();
    expect(within(d).getByText("classes.coach.fixedHelp")).toBeInTheDocument();
    expect(within(d).getByText("classes.modal.addTitle")).toBeInTheDocument();

    await user.type(d.querySelector<HTMLInputElement>("#className") as HTMLInputElement, "Pump");
    await user.type(d.querySelector<HTMLInputElement>("#classCapacity") as HTMLInputElement, "12");
    await user.click(within(d).getByLabelText("classes.modal.recurring"));
    const startDate = d.querySelector<HTMLInputElement>("#recurrenceStartDate") as HTMLInputElement;
    await user.type(startDate, "2026-12-01");
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
      coachId: "coach-1",
      scheduleType: "recurring",
      slots: [
        { weekday: 1, startTime: "07:00" },
        { weekday: 6, startTime: "09:00" },
      ],
    });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("[Edit] opens the class with its times as rows, and the result view of an edit is 29.2's", async () => {
    editClass.mockResolvedValue({
      data: { id: "hiit", leftUnchanged: [{ classSessionId: "s1", scheduledAt: "2026-11-23T06:00:00+00:00", bookedCount: 8, capacity: 15 }] },
      error: null,
    });
    const user = userEvent.setup();
    render(<CoachClassesPageClient classes={[LIVE]} coach={COACH} gymTimezone="Africa/Douala" />);

    await user.click(screen.getByRole("button", { name: "classes.edit" }));
    const d = dialog();
    expect(d.querySelector("select#classCoach")).toBeNull();
    expect(within(d).getByTestId("class-coach-fixed")).toHaveTextContent("Coach One");
    expect(within(d).getByDisplayValue("Evening burn")).toBeInTheDocument();
    const { days, times } = rowsIn(d);
    expect(days.map((s) => s.value)).toEqual(["1", "4"]);
    expect(times.map((i) => i.value)).toEqual(["07:00", "18:30"]);
    expect(within(d).getByText("classes.times.editNotice")).toBeInTheDocument();

    await user.clear(times[1]);
    await user.type(times[1], "19:00");
    await user.click(within(d).getByRole("button", { name: "classes.modal.saveChanges" }));

    await waitFor(() => expect(editClass).toHaveBeenCalledTimes(1));
    expect(editClass.mock.calls[0][0]).toBe("hiit");
    expect(editClass.mock.calls[0][1]).toMatchObject({
      coachId: "coach-1",
      slots: [
        { weekday: 1, startTime: "07:00" },
        { weekday: 4, startTime: "19:00" },
      ],
    });
    expect(await within(dialog()).findByTestId("class-saved-result")).toBeInTheDocument();
    expect(within(dialog()).getByText("classes.times.left.title1")).toBeInTheDocument();
  });

  it("a stale tab: the server refuses with the own-only message, the modal shows it and the list refreshes", async () => {
    editClass.mockResolvedValue({ data: null, error: { code: "class_coach_own_only", message: "classes.coach.ownOnly" } });
    const user = userEvent.setup();
    render(<CoachClassesPageClient classes={[LIVE]} coach={COACH} />);

    await user.click(screen.getByRole("button", { name: "classes.edit" }));
    await user.click(within(dialog()).getByRole("button", { name: "classes.modal.saveChanges" }));

    expect(await within(dialog()).findByText("classes.coach.ownOnly")).toBeInTheDocument();
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

describe("the first create from the empty state", () => {
  it("keeps the toast when the refresh swaps the empty state for the list (the dialogs are not remounted)", async () => {
    createClass.mockResolvedValue({ data: { id: "new" }, error: { code: "audit_log_failed", message: "WARN: audit failed" } });
    const user = userEvent.setup();
    const { rerender } = render(<CoachClassesPageClient classes={[]} coach={COACH} gymTimezone="Africa/Douala" />);

    await user.click(screen.getByRole("button", { name: "classes.coach.create" }));
    const d = dialog();
    await user.type(d.querySelector<HTMLInputElement>("#className") as HTMLInputElement, "Pump");
    await user.type(d.querySelector<HTMLInputElement>("#classCapacity") as HTMLInputElement, "12");
    await user.click(within(d).getByLabelText("classes.modal.recurring"));
    await user.type(d.querySelector<HTMLInputElement>("#recurrenceStartDate") as HTMLInputElement, "2026-12-01");
    await user.selectOptions(rowsIn(d).days[0], "1");
    await user.type(rowsIn(d).times[0], "07:00");
    await user.click(within(d).getByRole("button", { name: "classes.addClassButton" }));

    expect(await screen.findByRole("status")).toHaveTextContent("WARN: audit failed");
    expect(refresh).toHaveBeenCalled();

    rerender(<CoachClassesPageClient classes={[LIVE]} coach={COACH} gymTimezone="Africa/Douala" />);

    expect(screen.queryByText("classes.coach.empty")).toBeNull();
    expect(document.getElementById("class-hiit")).not.toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("WARN: audit failed");
  });
});

describe("the Cancel class dialog", () => {
  it("shows the booking count of the upcoming sessions and cancels through the action, then toasts and refreshes", async () => {
    cancelClassAction.mockResolvedValue({ data: { bookingsCancelled: 5 }, error: null });
    const user = userEvent.setup();
    render(<CoachClassesPageClient classes={[LIVE]} coach={COACH} />);

    await user.click(screen.getByRole("button", { name: "classes.cancel.action" }));
    const d = within(dialog());
    expect(d.getByText("classes.cancel.title|HIIT")).toBeInTheDocument();
    expect(d.getByText("classes.cancel.body|5")).toBeInTheDocument();
    await user.click(d.getByRole("button", { name: "classes.cancel.action" }));

    await waitFor(() => expect(cancelClassAction).toHaveBeenCalledWith("hiit"));
    expect(await screen.findByRole("status")).toHaveTextContent("classes.cancel.toast|HIIT");
    expect(refresh).toHaveBeenCalled();
  });

  it("uses the no-bookings copy when nobody has booked", async () => {
    const user = userEvent.setup();
    render(<CoachClassesPageClient classes={[view("quiet", {}, { upcomingBookingCount: 0 })]} coach={COACH} />);

    await user.click(screen.getByRole("button", { name: "classes.cancel.action" }));
    expect(within(dialog()).getByText("classes.cancel.bodyNoBookings")).toBeInTheDocument();
  });

  it("a refusal for a class that is not theirs shows classes.coach.ownOnly, offers no second confirm and refreshes on close", async () => {
    cancelClassAction.mockResolvedValue({ data: null, error: { code: "class_coach_own_only", message: "classes.coach.ownOnly" } });
    const user = userEvent.setup();
    render(<CoachClassesPageClient classes={[LIVE]} coach={COACH} />);

    await user.click(screen.getByRole("button", { name: "classes.cancel.action" }));
    await user.click(within(dialog()).getByRole("button", { name: "classes.cancel.action" }));

    expect(await within(dialog()).findByRole("alert")).toHaveTextContent("classes.coach.ownOnly");
    expect(within(dialog()).queryByRole("button", { name: "classes.cancel.action" })).toBeNull();
    await user.click(within(dialog()).getByRole("button", { name: "classes.cancel.keep" }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });
});
