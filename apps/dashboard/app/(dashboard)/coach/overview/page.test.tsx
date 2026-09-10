/**
 * Story 17.5 (AC #1-#4, #6-#8, #15): `/coach/overview`, AD-20. Asserted on the
 * element tree -- reach through the page's <Suspense> to the async child and
 * await it -- and on the widget elements' props.
 *
 *  - four reads, each called once; the fallback is AD-20's skeleton;
 *  - the grid, in AD-20's order: My Next Sessions, My Members At A Glance,
 *    Needs Follow-Up, Recent Progress Activity;
 *  - Story 17.3's At A Glance behaviour, unchanged;
 *  - each read failing ALONE puts only its own widget in its error state;
 *  - the layout table: no assigned members and no upcoming session -> AD-14's
 *    guidance alone; no assigned members but upcoming sessions (or a failed
 *    class read) -> My Next Sessions beside that guidance;
 *  - the links, and the thresholds interpolated into the copy.
 *
 * The translation mock keeps interpolation options visible (`key|{json}`).
 * Only Date is faked, so day counts do not depend on when the suite runs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isValidElement, type ReactElement, type ReactNode } from "react";

import type { CoachClassRow } from "@/services/classes";
import type { CoachMemberRecencyRow, CoachPortalMemberRow } from "@/services/coaches";

vi.mock("@/lib/i18n/get-request-locale", () => ({
  getRequestLocale: vi.fn(async () => "en"),
}));

vi.mock("@/lib/i18n/get-server-translation", () => ({
  getServerTranslation: vi.fn(async () => ({
    t: (key: string, opts?: Record<string, unknown>) => (opts ? `${key}|${JSON.stringify(opts)}` : key),
  })),
}));

const listAssignedMembers = vi.fn();
const listAssignedMemberNoteRecency = vi.fn();
const listAssignedMemberProgressRecency = vi.fn();
vi.mock("@/services/coaches", () => ({
  listAssignedMembers: (...args: unknown[]) => listAssignedMembers(...args),
  listAssignedMemberNoteRecency: (...args: unknown[]) => listAssignedMemberNoteRecency(...args),
  listAssignedMemberProgressRecency: (...args: unknown[]) => listAssignedMemberProgressRecency(...args),
}));

const listMyClasses = vi.fn();
vi.mock("@/services/classes", () => ({
  listMyClasses: (...args: unknown[]) => listMyClasses(...args),
}));

import CoachOverviewPage from "./page";
import CoachOverviewLoading from "./loading";
import { CaseloadList, type CaseloadListRow } from "./components/CaseloadList";
import { MembersAtAGlance } from "./components/MembersAtAGlance";
import { OverviewWidget } from "./components/OverviewWidget";

type AsyncComponent = (props: unknown) => Promise<ReactElement>;
type WidgetProps = { title: string; description?: string; link?: { href: string; label: string }; children: ReactElement };
type ListProps = { state: "error" | "ready"; errorLabel: string; emptyLabel: string; rows: CaseloadListRow[]; moreLabel: string | null };

const NOW = new Date("2026-09-10T08:00:00Z"); // 09:00 in Africa/Douala
const TZ = "Africa/Douala";

const TITLES = {
  nextSessions: "coachPortal.overview.nextSessions.title",
  atAGlance: "coachPortal.overview.membersAtAGlance.title",
  followUp: "coachPortal.overview.followUp.title",
  recentProgress: "coachPortal.overview.recentProgress.title",
};

const FAILED = { data: null, error: { code: "unknown", message: "boom" } };

function boundary(): ReactElement<{ children: ReactElement; fallback: ReactElement }> {
  return CoachOverviewPage() as ReactElement<{ children: ReactElement; fallback: ReactElement }>;
}

async function renderOverview(): Promise<ReactElement> {
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

function widgets(tree: ReactNode): ReactElement<WidgetProps>[] {
  return findAll(tree, (el) => el.type === OverviewWidget) as ReactElement<WidgetProps>[];
}

function widget(tree: ReactNode, title: string): ReactElement<WidgetProps> {
  const found = widgets(tree).find((w) => w.props.title === title);
  expect(found, `widget ${title}`).toBeDefined();
  return found!;
}

function list(tree: ReactNode, title: string): ListProps {
  const body = widget(tree, title).props.children;
  expect(body.type).toBe(CaseloadList);
  return body.props as ListProps;
}

/** Local noon in Douala, `n` gym-local calendar days before NOW's date. */
function daysAgo(n: number): string {
  return new Date(Date.UTC(2026, 8, 10 - n, 11, 0, 0)).toISOString();
}

function memberRows(counts: Partial<Record<CoachPortalMemberRow["status"], number>>): CoachPortalMemberRow[] {
  return Object.entries(counts).flatMap(([status, count]) =>
    Array.from({ length: count ?? 0 }, (_, i) => ({
      memberId: `${status}-${i}`,
      memberName: `Member ${status} ${i}`,
      planName: "Monthly",
      planType: "monthly",
      status: status as CoachPortalMemberRow["status"],
      expiryDate: "2026-10-01",
    })),
  );
}

function classRow(classId: string, className: string, sessions: [string, string, number][]): CoachClassRow {
  return {
    classId,
    className,
    capacity: 15,
    scheduleType: "recurring",
    oneOffSessionAt: null,
    recurrenceDays: [1, 3, 5],
    recurrenceTime: "18:00:00",
    gymTimezone: TZ,
    sessions: sessions.map(([classSessionId, scheduledAt, bookedCount]) => ({ classSessionId, scheduledAt, bookedCount })),
  };
}

function recency(memberId: string, memberName: string, lastAt: string | null): CoachMemberRecencyRow {
  return { memberId, memberName, gymTimezone: TZ, lastAt };
}

const CLASSES: CoachClassRow[] = [
  classRow("c-hiit", "HIIT Circuit", [
    ["s-hiit-earlier", "2026-09-10T06:00:00Z", 4],
    ["s-hiit-fri", "2026-09-11T17:00:00Z", 8],
  ]),
  classRow("c-yoga", "Morning Yoga", [["s-yoga-tonight", "2026-09-10T17:00:00Z", 11]]),
];

describe("/coach/overview", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    listAssignedMembers.mockReset().mockResolvedValue({ data: memberRows({ active: 9, expiring_soon: 2, expired: 1 }), error: null });
    listMyClasses.mockReset().mockResolvedValue({ data: CLASSES, error: null });
    listAssignedMemberNoteRecency.mockReset().mockResolvedValue({
      data: [recency("m-aicha", "Aicha", daysAgo(3)), recency("m-blaise", "Blaise", daysAgo(20)), recency("m-marc", "Marc", null)],
      error: null,
    });
    listAssignedMemberProgressRecency.mockReset().mockResolvedValue({
      data: [recency("m-aicha", "Aicha", daysAgo(2)), recency("m-olivier", "Olivier", daysAgo(40)), recency("m-marc", "Marc", null)],
      error: null,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("streams behind AD-20's own skeleton", () => {
    expect(boundary().props.fallback.type).toBe(CoachOverviewLoading);
  });

  it("makes each of its four reads exactly once", async () => {
    await renderOverview();

    expect(listAssignedMembers).toHaveBeenCalledTimes(1);
    expect(listAssignedMembers).toHaveBeenCalledWith({});
    expect(listMyClasses).toHaveBeenCalledTimes(1);
    expect(listAssignedMemberNoteRecency).toHaveBeenCalledTimes(1);
    expect(listAssignedMemberProgressRecency).toHaveBeenCalledTimes(1);
  });

  it("lays the four widgets out in AD-20's order", async () => {
    const tree = await renderOverview();

    expect(tree.props).toMatchObject({ className: "grid gap-4 md:grid-cols-2" });
    expect(widgets(tree).map((w) => w.props.title)).toEqual([
      TITLES.nextSessions,
      TITLES.atAGlance,
      TITLES.followUp,
      TITLES.recentProgress,
    ]);
  });

  describe("My Members At A Glance (Story 17.3, unchanged)", () => {
    it("shows the assigned total and the per-status breakdown in status order, skipping empty statuses", async () => {
      const tree = await renderOverview();
      const body = widget(tree, TITLES.atAGlance).props.children;

      expect(body.type).toBe(MembersAtAGlance);
      expect(body.props).toMatchObject({
        state: "ready",
        total: "12",
        assignedLabel: "coachPortal.overview.membersAtAGlance.assignedLabel",
        items: [
          { status: "active", label: "members.status.active", count: "9" },
          { status: "expiring_soon", label: "members.status.expiringSoon", count: "2" },
          { status: "expired", label: "members.status.expired", count: "1" },
        ],
      });
    });

    it("links 'All →' to the My Members list", async () => {
      const tree = await renderOverview();

      expect(widget(tree, TITLES.atAGlance).props.link).toEqual({
        href: "/coach",
        label: "coachPortal.overview.membersAtAGlance.viewAll",
      });
    });
  });

  describe("My Next Sessions", () => {
    it("lists upcoming sessions soonest first, dropping earlier-today ones, each linking to its class on My Classes", async () => {
      const tree = await renderOverview();
      const { state, rows, moreLabel } = list(tree, TITLES.nextSessions);

      expect(state).toBe("ready");
      expect(moreLabel).toBeNull();
      expect(rows.map((row) => [row.key, row.href, row.secondary])).toEqual([
        ["s-yoga-tonight", "/coach/classes#class-c-yoga", "Morning Yoga"],
        ["s-hiit-fri", "/coach/classes#class-c-hiit", "HIIT Circuit"],
      ]);
      expect(rows[0].primary).toContain("18:00");
      expect(rows[0].meta).toBe('coachPortal.classes.bookedCount|{"booked":"11","capacity":"15"}');
    });

    it("links 'All →' to My Classes and says when nothing is upcoming", async () => {
      listMyClasses.mockResolvedValue({ data: [], error: null });

      const tree = await renderOverview();

      expect(widget(tree, TITLES.nextSessions).props.link).toEqual({
        href: "/coach/classes",
        label: "coachPortal.overview.nextSessions.viewAll",
      });
      expect(list(tree, TITLES.nextSessions)).toMatchObject({
        state: "ready",
        rows: [],
        emptyLabel: "coachPortal.overview.nextSessions.empty",
      });
    });
  });

  describe("Needs Follow-Up", () => {
    it("flags members with no note or none for 14+ days, linking to their Session Notes", async () => {
      const tree = await renderOverview();
      const w = widget(tree, TITLES.followUp);
      const { rows, emptyLabel } = list(tree, TITLES.followUp);

      expect(w.props.description).toBe('coachPortal.overview.followUp.description|{"days":14}');
      expect(emptyLabel).toBe("coachPortal.overview.followUp.empty");
      expect(rows).toEqual([
        { key: "m-marc", href: "/coach/m-marc", primary: "Marc", secondary: "coachPortal.overview.followUp.noNoteYet" },
        {
          key: "m-blaise",
          href: "/coach/m-blaise",
          primary: "Blaise",
          secondary: 'coachPortal.overview.followUp.lastNote|{"when":"20 days ago"}',
        },
      ]);
    });

    it("shows five and counts the rest", async () => {
      listAssignedMemberNoteRecency.mockResolvedValue({
        data: Array.from({ length: 7 }, (_, i) => recency(`m-${i}`, `Member ${i}`, null)),
        error: null,
      });

      const tree = await renderOverview();
      const { rows, moreLabel } = list(tree, TITLES.followUp);

      expect(rows).toHaveLength(5);
      expect(moreLabel).toBe('coachPortal.overview.moreCount|{"count":2}');
    });
  });

  describe("Recent Progress Activity", () => {
    it("lists members who logged in the last 7 days, linking to their Progress tab", async () => {
      const tree = await renderOverview();
      const w = widget(tree, TITLES.recentProgress);
      const { rows, emptyLabel } = list(tree, TITLES.recentProgress);

      expect(w.props.description).toBe('coachPortal.overview.recentProgress.description|{"days":7}');
      expect(emptyLabel).toBe('coachPortal.overview.recentProgress.empty|{"days":7}');
      expect(rows).toEqual([
        {
          key: "m-aicha",
          href: "/coach/m-aicha?tab=progress",
          primary: "Aicha",
          secondary: 'coachPortal.overview.recentProgress.logged|{"when":"2 days ago"}',
        },
      ]);
    });
  });

  describe("per-widget failure isolation", () => {
    function states(tree: ReactNode) {
      const glance = widget(tree, TITLES.atAGlance).props.children.props as { state: string };
      return {
        nextSessions: list(tree, TITLES.nextSessions).state,
        atAGlance: glance.state,
        followUp: list(tree, TITLES.followUp).state,
        recentProgress: list(tree, TITLES.recentProgress).state,
      };
    }

    const READY = { nextSessions: "ready", atAGlance: "ready", followUp: "ready", recentProgress: "ready" };

    it("a failed class read fails My Next Sessions alone", async () => {
      listMyClasses.mockResolvedValue(FAILED);

      expect(states(await renderOverview())).toEqual({ ...READY, nextSessions: "error" });
    });

    it("a failed member read fails At A Glance alone, and still renders the grid", async () => {
      listAssignedMembers.mockResolvedValue(FAILED);

      const tree = await renderOverview();

      expect(widgets(tree)).toHaveLength(4);
      expect(states(tree)).toEqual({ ...READY, atAGlance: "error" });
    });

    it("a failed note read fails Needs Follow-Up alone", async () => {
      listAssignedMemberNoteRecency.mockResolvedValue(FAILED);

      expect(states(await renderOverview())).toEqual({ ...READY, followUp: "error" });
    });

    it("a failed progress read fails Recent Progress Activity alone", async () => {
      listAssignedMemberProgressRecency.mockResolvedValue(FAILED);

      expect(states(await renderOverview())).toEqual({ ...READY, recentProgress: "error" });
    });

    it("an error widget keeps its title and gets the inline load error", async () => {
      listAssignedMemberNoteRecency.mockResolvedValue(FAILED);

      const tree = await renderOverview();

      expect(list(tree, TITLES.followUp)).toMatchObject({ state: "error", errorLabel: "common.loadError" });
    });
  });

  describe("a Coach with no assigned members", () => {
    beforeEach(() => {
      listAssignedMembers.mockResolvedValue({ data: [], error: null });
    });

    it("sees only AD-14's guidance when no session is upcoming either", async () => {
      listMyClasses.mockResolvedValue({ data: [classRow("c-hiit", "HIIT Circuit", [["s-past", "2026-09-09T17:00:00Z", 3]])], error: null });

      const tree = await renderOverview();

      expect(textContent(tree)).toEqual(["coachPortal.emptyNoAssignments"]);
      expect(widgets(tree)).toHaveLength(0);
    });

    it("still makes both member-recency reads, and ignores the rows they return", async () => {
      listMyClasses.mockResolvedValue({ data: [], error: null });

      const tree = await renderOverview();

      expect(listAssignedMemberNoteRecency).toHaveBeenCalledTimes(1);
      expect(listAssignedMemberProgressRecency).toHaveBeenCalledTimes(1);
      expect(textContent(tree)).toEqual(["coachPortal.emptyNoAssignments"]);
    });

    it("sees My Next Sessions beside AD-14's guidance when sessions are upcoming", async () => {
      const tree = await renderOverview();
      const children = (tree.props as { children: ReactElement[] }).children;

      expect(tree.props).toMatchObject({ className: "grid gap-4 md:grid-cols-2" });
      expect(children).toHaveLength(2);
      expect(children[0].type).toBe(OverviewWidget);
      expect((children[0].props as WidgetProps).title).toBe(TITLES.nextSessions);
      expect(textContent(children[1])).toEqual(["coachPortal.emptyNoAssignments"]);
      expect(widgets(tree).map((w) => w.props.title)).toEqual([TITLES.nextSessions]);
      expect(list(tree, TITLES.nextSessions).rows).toHaveLength(2);
    });

    it("sees My Next Sessions' error beside the guidance when the class read fails, never a hidden failure", async () => {
      listMyClasses.mockResolvedValue(FAILED);

      const tree = await renderOverview();

      expect((tree.props as { children: ReactElement[] }).children).toHaveLength(2);
      expect(list(tree, TITLES.nextSessions).state).toBe("error");
      expect(textContent(tree)).toContain("coachPortal.emptyNoAssignments");
    });
  });
});
