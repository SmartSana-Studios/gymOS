/**
 * Story 17.4 (AC #9, #10, #12): `/coach/classes`, AD-21. Asserted on the
 * element tree with coach/overview/page.test.tsx's technique -- reach through
 * the page's <Suspense> to the async child and await it.
 *
 *  - one `listMyClasses()` call, no arguments;
 *  - Story 29.3: the signed-in Coach (member id and name from the shell context) is handed to the client as `coach` for the Coach role only,
 *    each class carries the row the Edit modal and the Cancel dialog read, and the dialog's booking count is the sum of the booked counts of
 *    the sessions later than now;
 *  - the fallback is AD-21's 3-row skeleton;
 *  - a failed read -> the app's inline `common.loadError`;
 *  - zero classes -> AD-21's empty state and no client component;
 *  - otherwise every label is formatted HERE, on the server, in the gym's own
 *    timezone -- the client component receives strings only. The same instant
 *    must read 18:00 for an Africa/Douala gym and 17:00 for a UTC gym, which
 *    proves the gym's zone is used rather than the test runner's.
 *
 * The translation mock keeps interpolation options visible
 * (`key|{json}`), so the composed labels can be asserted exactly.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isValidElement, type ReactElement, type ReactNode } from "react";

import type { CoachClassRow } from "@/services/classes";

vi.mock("@/lib/i18n/get-request-locale", () => ({
  getRequestLocale: vi.fn(async () => "en"),
}));

vi.mock("@/lib/i18n/get-server-translation", () => ({
  getServerTranslation: vi.fn(async () => ({
    t: (key: string, opts?: Record<string, unknown>) => (opts ? `${key}|${JSON.stringify(opts)}` : key),
  })),
}));

const listMyClasses = vi.fn();
const getClassesGymTimezone = vi.fn();
vi.mock("@/services/classes", () => ({
  listMyClasses: (...args: unknown[]) => listMyClasses(...args),
  getClassesGymTimezone: (...args: unknown[]) => getClassesGymTimezone(...args),
}));

const getDashboardShellContext = vi.fn();
vi.mock("@/services/session", () => ({
  getDashboardShellContext: (...args: unknown[]) => getDashboardShellContext(...args),
}));

vi.mock("./components/CoachClassesPageClient", () => ({
  CoachClassesPageClient: function CoachClassesPageClient() {
    return null;
  },
}));

import CoachClassesPage from "./page";
import CoachClassesLoading from "./loading";
import { CoachClassesPageClient, type CoachClassView } from "./components/CoachClassesPageClient";

type AsyncComponent = (props: unknown) => Promise<ReactElement>;

function boundary(): ReactElement<{ children: ReactElement; fallback: ReactElement }> {
  return CoachClassesPage() as ReactElement<{ children: ReactElement; fallback: ReactElement }>;
}

async function renderPage(): Promise<ReactElement> {
  const child = boundary().props.children;
  return await (child.type as AsyncComponent)(child.props);
}

function findAll(node: ReactNode, match: (el: ReactElement) => boolean): ReactElement[] {
  if (Array.isArray(node)) return node.flatMap((child) => findAll(child, match));
  if (!isValidElement(node)) return [];
  const own = match(node) ? [node] : [];
  return [...own, ...findAll((node.props as { children?: ReactNode }).children, match)];
}

function textContent(node: ReactNode): string[] {
  if (typeof node === "string") return [node];
  if (Array.isArray(node)) return node.flatMap(textContent);
  if (!isValidElement(node)) return [];
  return textContent((node.props as { children?: ReactNode }).children);
}

async function classViews(): Promise<CoachClassView[]> {
  const tree = await renderPage();
  const [client] = findAll(tree, (el) => el.type === CoachClassesPageClient);
  expect(client).toBeDefined();
  return (client.props as { classes: CoachClassView[] }).classes;
}

const HIIT: CoachClassRow = {
  classId: "class-hiit",
  className: "HIIT Circuit",
  capacity: 15,
  scheduleType: "recurring",
  oneOffSessionAt: null,
  slots: [
    { weekday: 1, startTime: "18:00" },
    { weekday: 3, startTime: "18:00" },
    { weekday: 5, startTime: "18:00" },
  ],
  cancelledAt: null,
  gymTimezone: "Africa/Douala",
  sessions: [{ classSessionId: "session-1", scheduledAt: "2026-09-11T17:00:00Z", bookedCount: 11, matchesSlots: true }],
};

const WORKSHOP: CoachClassRow = {
  classId: "class-workshop",
  className: "Weekend Workshop",
  capacity: 10,
  scheduleType: "one_off",
  oneOffSessionAt: "2026-08-31T09:00:00Z",
  slots: [],
  cancelledAt: null,
  gymTimezone: "Africa/Douala",
  sessions: [],
};

describe("/coach/classes", () => {
  beforeEach(() => {
    // Only Date is faked: "is this the current year?" must not depend on when
    // the suite runs.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-10T12:00:00Z"));
    listMyClasses.mockReset().mockResolvedValue({ data: [HIIT, WORKSHOP], error: null });
    getClassesGymTimezone.mockReset().mockResolvedValue({ data: "Africa/Douala", error: null });
    getDashboardShellContext.mockReset().mockResolvedValue({
      data: { role: "coach", memberId: "member-coach", memberName: "Coach One" },
      error: null,
      suspended: null,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("streams behind AD-21's own skeleton", () => {
    expect(boundary().props.fallback.type).toBe(CoachClassesLoading);
  });

  it("renders three text-free skeleton class rows", () => {
    const skeleton = CoachClassesLoading() as ReactElement<{ children: ReactNode; "aria-busy"?: string }>;

    expect(skeleton.props["aria-busy"]).toBe("true");
    expect(findAll(skeleton.props.children, () => true)).toHaveLength(3);
    expect(textContent(skeleton)).toEqual([]);
  });

  it("reads the Coach's classes with one listMyClasses() call and no arguments", async () => {
    await renderPage();

    expect(listMyClasses).toHaveBeenCalledTimes(1);
    expect(listMyClasses).toHaveBeenCalledWith();
  });

  it("renders the inline load error when the read fails", async () => {
    listMyClasses.mockResolvedValue({ data: null, error: { code: "unknown", message: "boom" } });

    const tree = await renderPage();

    expect(textContent(tree)).toEqual(["common.loadError"]);
    expect(findAll(tree, (el) => el.type === CoachClassesPageClient)).toHaveLength(0);
  });

  it("hands the client an empty list and the Coach when the Coach teaches no classes (the client draws the empty state with [+ Create class])", async () => {
    listMyClasses.mockResolvedValue({ data: [], error: null });

    const tree = await renderPage();

    expect(tree.type).toBe(CoachClassesPageClient);
    expect(tree.props).toMatchObject({ classes: [], coach: { id: "member-coach", name: "Coach One" }, gymTimezone: "Africa/Douala" });
  });

  it("passes the signed-in Coach from the shell context, never from anything the client sends", async () => {
    const tree = await renderPage();

    expect(tree.props).toMatchObject({ coach: { id: "member-coach", name: "Coach One" }, gymTimezone: "Africa/Douala" });
    expect(getDashboardShellContext).toHaveBeenCalledTimes(1);
  });

  it.each(["owner", "manager", "supervisor", "receptionist"])("passes no Coach, and builds no edit row, for the %s role", async (role) => {
    getDashboardShellContext.mockResolvedValue({ data: { role, memberId: "member-x", memberName: "Staff" }, error: null, suspended: null });

    const tree = await renderPage();

    expect((tree.props as { coach: unknown }).coach).toBeNull();
    expect(getClassesGymTimezone).not.toHaveBeenCalled();
    for (const view of (tree.props as { classes: CoachClassView[] }).classes) expect(view.editRow).toBeUndefined();
  });

  it("renders the inline load error, not a read-only list, when the shell read fails", async () => {
    getDashboardShellContext.mockResolvedValue({ data: null, error: { code: "unknown", message: "boom" }, suspended: null });

    const tree = await renderPage();

    expect(textContent(tree)).toEqual(["common.loadError"]);
    expect(findAll(tree, (el) => el.type === CoachClassesPageClient)).toHaveLength(0);
  });

  it("passes no Coach when the shell has no member id", async () => {
    getDashboardShellContext.mockResolvedValue({ data: { role: "coach", memberId: null, memberName: "" }, error: null, suspended: null });

    const tree = await renderPage();

    expect((tree.props as { coach: unknown }).coach).toBeNull();
  });

  it("builds each class's edit row: the Coach is its coach, and the cancel count is the booked sum of the sessions later than now", async () => {
    listMyClasses.mockResolvedValue({
      data: [
        {
          ...HIIT,
          description: "Evening burn",
          recurrenceStartDate: "2026-09-01",
          sessions: [
            { classSessionId: "session-past", scheduledAt: "2026-09-10T08:00:00Z", bookedCount: 7, matchesSlots: true },
            { classSessionId: "session-1", scheduledAt: "2026-09-11T17:00:00Z", bookedCount: 11, matchesSlots: true },
            { classSessionId: "session-2", scheduledAt: "2026-09-14T17:00:00Z", bookedCount: 4, matchesSlots: false },
          ],
        },
      ],
      error: null,
    });

    const [hiit] = await classViews();

    expect(hiit.editRow).toMatchObject({
      id: "class-hiit",
      name: "HIIT Circuit",
      description: "Evening burn",
      coachId: "member-coach",
      coachName: "Coach One",
      capacity: 15,
      scheduleType: "recurring",
      recurrenceStartDate: "2026-09-01",
      cancelledAt: null,
      upcomingBookingCount: 15,
      nextSessionId: "session-1",
      nextSessionMatchesSlots: true,
    });
    expect(hiit.editRow?.slots).toHaveLength(3);
  });

  it("a class with no upcoming session has a zero cancel count and no next session", async () => {
    const [, workshop] = await classViews();

    expect(workshop.editRow).toMatchObject({ upcomingBookingCount: 0, nextSessionId: null, nextSessionAt: null, description: null });
  });

  it("hands the client component one view per class, in order", async () => {
    const views = await classViews();

    expect(views.map((view) => [view.classId, view.className])).toEqual([
      ["class-hiit", "HIIT Circuit"],
      ["class-workshop", "Weekend Workshop"],
    ]);
  });

  it("composes a recurring schedule from the translated days and HH:mm", async () => {
    const [hiit] = await classViews();

    expect(hiit.scheduleLabel).toBe(
      'classes.recurringSummary|{"days":"classes.days.mon, classes.days.wed, classes.days.fri","time":"18:00"}',
    );
  });

  it("tags a cancelled class and a session kept on an old time (Story 29.2)", async () => {
    listMyClasses.mockResolvedValue({
      data: [
        {
          ...HIIT,
          cancelledAt: "2026-09-10T09:00:00Z",
          sessions: [{ classSessionId: "session-1", scheduledAt: "2026-09-11T17:00:00Z", bookedCount: 11, matchesSlots: false }],
        },
        HIIT,
      ],
      error: null,
    });

    const [cancelled, live] = await classViews();

    expect(cancelled.cancelledLabel).toBe("classes.cancel.badge");
    expect(cancelled.sessions[0].oldTimeLabel).toBe("classes.times.oldTimeTag");
    expect(live.cancelledLabel).toBeUndefined();
    expect(live.sessions[0].oldTimeLabel).toBeUndefined();
  });

  it("formats capacity and the booked count as locale numbers inside their keys", async () => {
    const [hiit] = await classViews();

    expect(hiit.capacityLabel).toBe('coachPortal.classes.capacity|{"capacity":"15"}');
    expect(hiit.sessions).toHaveLength(1);
    expect(hiit.sessions[0].classSessionId).toBe("session-1");
    expect(hiit.sessions[0].bookedLabel).toBe('coachPortal.classes.bookedCount|{"booked":"11","capacity":"15"}');
  });

  it("formats session times in the gym's timezone, 24-hour", async () => {
    const [hiit] = await classViews();

    expect(hiit.sessions[0].label).toContain("18:00");
  });

  it("uses the gym's timezone, not the runtime's: the same instant reads 17:00 for a UTC gym", async () => {
    listMyClasses.mockResolvedValue({ data: [{ ...HIIT, gymTimezone: "UTC" }], error: null });

    const [hiit] = await classViews();

    expect(hiit.sessions[0].label).toContain("17:00");
  });

  it("formats a one-off class's schedule in the gym's timezone and keeps its empty session list", async () => {
    const [, workshop] = await classViews();

    expect(workshop.scheduleLabel).toContain("10:00");
    expect(workshop.sessions).toEqual([]);
  });

  it("leaves the year off dates in the current gym-local year", async () => {
    const [hiit, workshop] = await classViews();

    expect(hiit.sessions[0].label).not.toContain("2026");
    expect(workshop.scheduleLabel).not.toContain("2026");
  });

  it("adds the year to a date outside the current year, so a finished class from last year cannot read as upcoming", async () => {
    listMyClasses.mockResolvedValue({ data: [{ ...WORKSHOP, oneOffSessionAt: "2025-08-31T09:00:00Z" }], error: null });

    const [workshop] = await classViews();

    expect(workshop.scheduleLabel).toContain("2025");
  });

  it("decides the year in the gym's timezone: 23:30 UTC on 31 December is already next year in Douala", async () => {
    listMyClasses.mockResolvedValue({
      data: [{ ...HIIT, sessions: [{ classSessionId: "session-nye", scheduledAt: "2026-12-31T23:30:00Z", bookedCount: 0 }] }],
      error: null,
    });

    const [hiit] = await classViews();

    expect(hiit.sessions[0].label).toContain("2027");
    expect(hiit.sessions[0].label).toContain("00:30");
  });

  it("renders nothing but the class list when there are classes -- 17.3's placeholder note is gone", async () => {
    const tree = await renderPage();

    expect(tree.type).toBe(CoachClassesPageClient);
    expect(textContent(tree)).toEqual([]);
  });

  it("falls back to the first class's timezone when the gym's own read gives none", async () => {
    getClassesGymTimezone.mockResolvedValue({ data: null, error: null });

    const tree = await renderPage();

    expect((tree.props as { gymTimezone: string | null }).gymTimezone).toBe("Africa/Douala");
  });
});
