/**
 * Story 29.4 (UX AD-21 in picker mode): the chosen coach's classes, read-only.
 *  - no [+ Create class], [Edit] or [Cancel class] anywhere in the DOM, and no dialog;
 *  - rosters come from the picker's action with the chosen coach, never from the Coach's own action;
 *  - each class has a text link [Open in Classes] to the admin Classes page; a cancelled class is listed with its badge and the same link;
 *  - the empty state is coach.picker.noClasses with the coach's name, and offers no create button.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { CoachRosterRow } from "@/services/classes";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => (opts ? `${key}|${JSON.stringify(opts)}` : key),
    i18n: { language: "en" },
  }),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

type RosterResult = { data: CoachRosterRow[] | null; error: { code: string; message: string } | null };
const getMySessionRosterAction = vi.fn<(classSessionId: string) => Promise<RosterResult>>();
vi.mock("../actions", () => ({
  getMySessionRosterAction: (id: string) => getMySessionRosterAction(id),
}));
const getCoachSessionRosterAction = vi.fn<(coachId: string, classSessionId: string) => Promise<RosterResult>>();
vi.mock("../pickerActions", () => ({
  getCoachSessionRosterAction: (coachId: string, id: string) => getCoachSessionRosterAction(coachId, id),
}));

import { CoachClassesPageClient, type CoachClassView } from "./CoachClassesPageClient";

const COACH = "11111111-1111-4111-8111-111111111111";
const PICKER = { coachId: COACH, coachName: "Coach A" };

const CLASSES: CoachClassView[] = [
  {
    classId: "class-hiit",
    className: "HIIT Circuit",
    scheduleLabel: "Mon, Wed, Fri at 18:00",
    capacityLabel: "Capacity 15",
    sessions: [{ classSessionId: "session-a", label: "Session A", bookedLabel: "2/15 booked" }],
  },
  {
    classId: "class-old",
    className: "Old Class",
    scheduleLabel: "Tue 12:30",
    capacityLabel: "Capacity 10",
    cancelledLabel: "Cancelled",
    sessions: [],
  },
];

describe("CoachClassesPageClient in picker mode", () => {
  beforeEach(() => {
    getMySessionRosterAction.mockReset();
    getCoachSessionRosterAction.mockReset().mockResolvedValue({
      data: [
        { memberId: "m1", memberName: "Amara K.", attendedAt: "2026-09-10T17:05:00Z" },
        { memberId: "m2", memberName: "Jean B.", attendedAt: null },
      ],
      error: null,
    });
  });

  it("has no create, edit or cancel control and no dialog, even for a live class", () => {
    const { container } = render(<CoachClassesPageClient classes={CLASSES} picker={PICKER} />);

    for (const absent of ["classes.coach.create", "classes.edit", "classes.cancel.action"]) {
      expect(screen.queryByText(absent), absent).toBeNull();
    }
    expect(container.querySelector("dialog")).toBeNull();
    expect(container.querySelector("form")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("links every class, cancelled ones included, to the admin Classes page with a text link", () => {
    render(<CoachClassesPageClient classes={CLASSES} picker={PICKER} />);

    const links = screen.getAllByRole("link");
    expect(links.map((l) => l.getAttribute("href"))).toEqual(["/classes", "/classes"]);
    for (const link of links) expect(link.textContent).toContain("coach.picker.openInClasses");
  });

  it("lists a cancelled class with its badge", () => {
    render(<CoachClassesPageClient classes={CLASSES} picker={PICKER} />);

    expect(within(document.getElementById("class-class-old")!).getByText("Cancelled")).toBeInTheDocument();
  });

  it("reads a session's roster from the picker action with the chosen coach, every time, and never from the Coach's own action", async () => {
    const user = userEvent.setup();
    render(<CoachClassesPageClient classes={CLASSES} picker={PICKER} />);

    await user.click(screen.getByRole("button", { name: /HIIT Circuit/ }));
    await user.click(screen.getByRole("button", { name: /Session A/ }));

    expect(await screen.findByText("Amara K.")).toBeInTheDocument();
    expect(screen.getByText("Jean B.")).toBeInTheDocument();
    expect(getCoachSessionRosterAction).toHaveBeenCalledWith(COACH, "session-a");
    expect(getMySessionRosterAction).not.toHaveBeenCalled();
  });

  it("shows the roster as name and attendance only: no mark control", async () => {
    const user = userEvent.setup();
    render(<CoachClassesPageClient classes={CLASSES} picker={PICKER} />);
    await user.click(screen.getByRole("button", { name: /HIIT Circuit/ }));
    await user.click(screen.getByRole("button", { name: /Session A/ }));
    await screen.findByText("Amara K.");

    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByText(/mark/i)).toBeNull();
    expect(screen.getByText("classes.attendance.attended")).toBeInTheDocument();
  });

  it("the empty state is the coach's own line with their name, and offers no create button", () => {
    render(<CoachClassesPageClient classes={[]} picker={PICKER} />);

    expect(screen.getByText('coach.picker.noClasses|{"name":"Coach A"}')).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("without picker or coach (any other role) there is no Open in Classes link", () => {
    render(<CoachClassesPageClient classes={CLASSES} />);

    expect(screen.queryByRole("link")).toBeNull();
  });
});
