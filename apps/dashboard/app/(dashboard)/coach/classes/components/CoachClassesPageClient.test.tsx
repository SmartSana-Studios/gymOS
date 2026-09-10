/**
 * Story 17.4 (AC #11): the My Classes list is read-only and lazy.
 *
 *  - classes start collapsed and expand independently; each class section is
 *    the `#class-<id>` anchor Story 17.5 links to;
 *  - expanding a session fetches its roster EVERY time (attendance marked at
 *    the desk must show on the next expand);
 *  - stale responses are dropped by a request counter -- including the case a
 *    session-id guard misses: the SAME session collapsed and re-expanded;
 *  - collapsing a class collapses its expanded session and drops its request;
 *  - loading / error / empty / roster panel states;
 *  - nothing on the page but disclosure buttons: no write control, no link,
 *    no form.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { CoachRosterRow } from "@/services/classes";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));

type RosterResult = { data: CoachRosterRow[] | null; error: { code: string; message: string } | null };
const getMySessionRosterAction = vi.fn<(classSessionId: string) => Promise<RosterResult>>();
vi.mock("../actions", () => ({
  getMySessionRosterAction: (classSessionId: string) => getMySessionRosterAction(classSessionId),
}));

import { CoachClassesPageClient, type CoachClassView } from "./CoachClassesPageClient";

const CLASSES: CoachClassView[] = [
  {
    classId: "class-hiit",
    className: "HIIT Circuit",
    scheduleLabel: "Mon, Wed, Fri at 18:00",
    capacityLabel: "Capacity 15",
    sessions: [
      { classSessionId: "session-a", label: "Session A", bookedLabel: "2/15 booked" },
      { classSessionId: "session-b", label: "Session B", bookedLabel: "0/15 booked" },
    ],
  },
  {
    classId: "class-workshop",
    className: "Weekend Workshop",
    scheduleLabel: "Aug 31, 10:00",
    capacityLabel: "Capacity 10",
    sessions: [],
  },
];

const ROSTER_A: CoachRosterRow[] = [
  { memberId: "m-alice", memberName: "Alice Member", attendedAt: "2026-09-10T17:05:00Z" },
  { memberId: "m-bob", memberName: "Bob Member", attendedAt: null },
];

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function classButton(name: RegExp) {
  return screen.getByRole("button", { name });
}

function sessionButton(name: string) {
  return screen.getByRole("button", { name: new RegExp(name) });
}

async function openClass(user: ReturnType<typeof userEvent.setup>, name = /HIIT Circuit/) {
  await user.click(classButton(name));
}

describe("CoachClassesPageClient", () => {
  beforeEach(() => {
    getMySessionRosterAction.mockReset().mockResolvedValue({ data: ROSTER_A, error: null });
  });

  it("renders one anchored section per class, every class collapsed", () => {
    const { container } = render(<CoachClassesPageClient classes={CLASSES} />);

    expect(container.querySelector("section#class-class-hiit")).not.toBeNull();
    expect(container.querySelector("section#class-class-workshop")).not.toBeNull();
    expect(classButton(/HIIT Circuit/)).toHaveAttribute("aria-expanded", "false");
    expect(classButton(/Weekend Workshop/)).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: /Session A/ })).toBeNull();
  });

  it("puts each class header in a heading, with its schedule and capacity", () => {
    render(<CoachClassesPageClient classes={CLASSES} />);

    const heading = screen.getByRole("heading", { level: 2, name: /HIIT Circuit/ });
    expect(heading).toHaveTextContent("Mon, Wed, Fri at 18:00");
    expect(heading).toHaveTextContent("Capacity 15");
  });

  it("expands a class to reveal its sessions and booked counts", async () => {
    const user = userEvent.setup();
    render(<CoachClassesPageClient classes={CLASSES} />);

    await openClass(user);

    expect(classButton(/HIIT Circuit/)).toHaveAttribute("aria-expanded", "true");
    expect(classButton(/HIIT Circuit/)).toHaveAttribute("aria-controls", "class-class-hiit-sessions");
    expect(sessionButton("Session A")).toHaveTextContent("2/15 booked");
    expect(sessionButton("Session B")).toHaveAttribute("aria-expanded", "false");
  });

  it("shows the no-session message for a class with nothing in the window", async () => {
    const user = userEvent.setup();
    render(<CoachClassesPageClient classes={CLASSES} />);

    await openClass(user, /Weekend Workshop/);

    expect(within(document.getElementById("class-class-workshop-sessions")!).getByText("classes.noUpcomingSession")).toBeInTheDocument();
  });

  it("loads the roster on expand and renders names with read-only attendance status", async () => {
    const user = userEvent.setup();
    render(<CoachClassesPageClient classes={CLASSES} />);
    await openClass(user);

    await user.click(sessionButton("Session A"));

    expect(getMySessionRosterAction).toHaveBeenCalledTimes(1);
    expect(getMySessionRosterAction).toHaveBeenCalledWith("session-a");
    expect(sessionButton("Session A")).toHaveAttribute("aria-expanded", "true");
    const panel = document.getElementById("session-session-a-roster")!;
    expect(within(panel).getByText("Alice Member")).toBeInTheDocument();
    expect(within(panel).getByText("Bob Member")).toBeInTheDocument();
    expect(within(panel).getAllByText("classes.attendance.attended")).toHaveLength(1);
    expect(within(panel).getAllByText("coachPortal.classes.notAttended")).toHaveLength(1);
    expect(within(panel).getByText("coachPortal.classes.notAttended")).toHaveClass("sr-only");
  });

  it("shows the loading state while the roster is on its way", async () => {
    const user = userEvent.setup();
    const pending = deferred<RosterResult>();
    getMySessionRosterAction.mockReturnValueOnce(pending.promise);
    render(<CoachClassesPageClient classes={CLASSES} />);
    await openClass(user);

    await user.click(sessionButton("Session A"));

    expect(within(document.getElementById("session-session-a-roster")!).getByText("classes.attendance.loadingBookings")).toBeInTheDocument();
    await act(async () => pending.resolve({ data: [], error: null }));
  });

  it("fetches again on every expand, so attendance marked at the desk shows up", async () => {
    const user = userEvent.setup();
    render(<CoachClassesPageClient classes={CLASSES} />);
    await openClass(user);

    await user.click(sessionButton("Session A"));
    await user.click(sessionButton("Session A"));
    expect(sessionButton("Session A")).toHaveAttribute("aria-expanded", "false");
    await user.click(sessionButton("Session A"));

    expect(getMySessionRosterAction).toHaveBeenCalledTimes(2);
  });

  it("keeps one session expanded at a time, and a late response for the previous one never renders", async () => {
    const user = userEvent.setup();
    const first = deferred<RosterResult>();
    getMySessionRosterAction
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce({ data: [{ memberId: "m-dan", memberName: "Dan Member", attendedAt: null }], error: null });
    render(<CoachClassesPageClient classes={CLASSES} />);
    await openClass(user);

    await user.click(sessionButton("Session A"));
    await user.click(sessionButton("Session B"));
    await act(async () => first.resolve({ data: ROSTER_A, error: null }));

    expect(sessionButton("Session A")).toHaveAttribute("aria-expanded", "false");
    expect(sessionButton("Session B")).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Dan Member")).toBeInTheDocument();
    expect(screen.queryByText("Alice Member")).toBeNull();
  });

  it("drops the first response when the SAME session is collapsed and re-expanded before it arrives", async () => {
    const user = userEvent.setup();
    const first = deferred<RosterResult>();
    const second = deferred<RosterResult>();
    getMySessionRosterAction.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    render(<CoachClassesPageClient classes={CLASSES} />);
    await openClass(user);

    await user.click(sessionButton("Session A"));
    await user.click(sessionButton("Session A"));
    await user.click(sessionButton("Session A"));
    await act(async () => second.resolve({ data: [{ memberId: "m-dan", memberName: "Dan Member", attendedAt: null }], error: null }));
    await act(async () => first.resolve({ data: ROSTER_A, error: null }));

    expect(screen.getByText("Dan Member")).toBeInTheDocument();
    expect(screen.queryByText("Alice Member")).toBeNull();
  });

  it("collapsing a class collapses its expanded session and drops that session's in-flight roster", async () => {
    const user = userEvent.setup();
    const pending = deferred<RosterResult>();
    getMySessionRosterAction.mockReturnValueOnce(pending.promise);
    render(<CoachClassesPageClient classes={CLASSES} />);
    await openClass(user);
    await user.click(sessionButton("Session A"));

    await user.click(classButton(/HIIT Circuit/));
    await act(async () => pending.resolve({ data: ROSTER_A, error: null }));
    await openClass(user);

    expect(sessionButton("Session A")).toHaveAttribute("aria-expanded", "false");
    expect(sessionButton("Session B")).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Alice Member")).toBeNull();
  });

  it("shows the inline load error inside the panel when the roster read fails", async () => {
    const user = userEvent.setup();
    getMySessionRosterAction.mockResolvedValueOnce({ data: null, error: { code: "unknown", message: "boom" } });
    render(<CoachClassesPageClient classes={CLASSES} />);
    await openClass(user);

    await user.click(sessionButton("Session A"));

    expect(within(document.getElementById("session-session-a-roster")!).getByText("common.loadError")).toBeInTheDocument();
  });

  it("shows the inline load error, not an endless spinner, when the roster call itself rejects", async () => {
    const user = userEvent.setup();
    getMySessionRosterAction.mockRejectedValueOnce(new Error("network down"));
    render(<CoachClassesPageClient classes={CLASSES} />);
    await openClass(user);

    await user.click(sessionButton("Session A"));

    const panel = document.getElementById("session-session-a-roster")!;
    expect(await within(panel).findByText("common.loadError")).toBeInTheDocument();
    expect(within(panel).queryByText("classes.attendance.loadingBookings")).toBeNull();
  });

  it("says no one is booked for an empty roster", async () => {
    const user = userEvent.setup();
    getMySessionRosterAction.mockResolvedValueOnce({ data: [], error: null });
    render(<CoachClassesPageClient classes={CLASSES} />);
    await openClass(user);

    await user.click(sessionButton("Session B"));

    expect(within(document.getElementById("session-session-b-roster")!).getByText("classes.attendance.noBookings")).toBeInTheDocument();
  });

  it("renders no write control, link or form -- every button is a disclosure", async () => {
    const user = userEvent.setup();
    const { container } = render(<CoachClassesPageClient classes={CLASSES} />);
    await openClass(user);
    await openClass(user, /Weekend Workshop/);
    await user.click(sessionButton("Session A"));

    const buttons = container.querySelectorAll("button");
    expect(buttons.length).toBeGreaterThan(0);
    buttons.forEach((button) => expect(button).toHaveAttribute("aria-expanded"));
    expect(container.querySelectorAll("a, form, input, select, textarea")).toHaveLength(0);
    expect(screen.queryByText("classes.attendance.markAttended")).toBeNull();
  });
});
