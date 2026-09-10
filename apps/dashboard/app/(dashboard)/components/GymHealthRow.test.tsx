/**
 * Story 17.2 (AC #2, #4, #5, #7, #8, #12, #13): the Manager-plus gym-health
 * row. Asserted on the element tree the async Server Component returns --
 * awaited directly, as page.overview.test.tsx does -- with every service
 * mocked, so only this component's own decisions are under test:
 *
 *  - four `StatCard`s in AD-02 V2's order, with their click-through targets;
 *  - "Active members" and "At risk" count by the same named status groups
 *    their cards link to;
 *  - the two date-bounded counts take their windows from ONE bounds read;
 *  - every figure is formatted with the request locale;
 *  - "At risk" is red only when it loaded and is non-zero;
 *  - one failed read degrades only its own card, and a failed bounds read
 *    degrades exactly the two cards that need it without attempting their
 *    counts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { isValidElement, type ReactElement, type ReactNode } from "react";

const getServerTranslation = vi.fn<(locale: string) => Promise<{ t: (key: string) => string }>>(async () => ({
  t: (key: string) => key,
}));
vi.mock("@/lib/i18n/get-server-translation", () => ({
  getServerTranslation: (locale: string) => getServerTranslation(locale),
}));

const countSubscriptions = vi.fn();
vi.mock("@/services/subscriptions", () => ({
  countSubscriptions: (...args: unknown[]) => countSubscriptions(...args),
}));

const countMembersJoinedBetween = vi.fn();
vi.mock("@/services/members", () => ({
  countMembersJoinedBetween: (...args: unknown[]) => countMembersJoinedBetween(...args),
}));

const countClassSessionsBetween = vi.fn();
vi.mock("@/services/classes", () => ({
  countClassSessionsBetween: (...args: unknown[]) => countClassSessionsBetween(...args),
}));

const getGymLocalPeriodBounds = vi.fn();
vi.mock("@/services/gym-settings", () => ({
  getGymLocalPeriodBounds: () => getGymLocalPeriodBounds(),
}));

import { GymHealthRow, GymHealthRowSkeleton } from "./GymHealthRow";
import { StatCard } from "@/components/ui/stat-card";

const BOUNDS = {
  monthStartDate: "2026-09-01",
  nextMonthStartDate: "2026-10-01",
  dayStart: "2026-09-09T23:00:00+00:00",
  nextDayStart: "2026-09-10T23:00:00+00:00",
};

const FAILED = { data: null, error: { code: "unknown", message: "boom" } };

type CardProps = { label: string; value: string; href: string; tone?: string };

function findAll(node: ReactNode, type: unknown): ReactElement[] {
  if (Array.isArray(node)) return node.flatMap((child) => findAll(child, type));
  if (!isValidElement(node)) return [];
  const own = node.type === type ? [node] : [];
  return [...own, ...findAll((node.props as { children?: ReactNode }).children, type)];
}

async function renderRow(locale: "en" | "fr" = "en"): Promise<ReactElement> {
  return (await GymHealthRow({ locale })) as ReactElement;
}

function cards(tree: ReactElement): CardProps[] {
  return findAll(tree, StatCard).map((el) => el.props as CardProps);
}

function card(tree: ReactElement, label: string): CardProps {
  const found = cards(tree).find((c) => c.label === label);
  if (!found) throw new Error(`no StatCard labelled ${label}`);
  return found;
}

let subscriptionCounts: Record<string, { data: number | null; error: unknown }>;
let consoleError: ReturnType<typeof vi.spyOn>;

describe("GymHealthRow", () => {
  beforeEach(() => {
    subscriptionCounts = {
      active_or_expiring: { data: 1200, error: null },
      at_risk: { data: 5, error: null },
    };
    countSubscriptions
      .mockReset()
      .mockImplementation(async ({ status }: { status: string }) => subscriptionCounts[status] ?? FAILED);
    getGymLocalPeriodBounds.mockReset().mockResolvedValue({ data: BOUNDS, error: null });
    countMembersJoinedBetween.mockReset().mockResolvedValue({ data: 3, error: null });
    countClassSessionsBetween.mockReset().mockResolvedValue({ data: 2, error: null });
    getServerTranslation.mockClear();
    // spyOn returns the existing spy on later calls, so clear its history too.
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    consoleError.mockClear();
  });

  it("renders the four gym-health cards, in order, with their click-through targets", async () => {
    const tree = await renderRow();

    expect(cards(tree)).toEqual([
      { label: "overview.cards.activeMembers", value: "1,200", href: "/subscriptions?status=active_or_expiring" },
      { label: "overview.cards.newThisMonth", value: "3", href: "/members" },
      { label: "overview.cards.todaysClasses", value: "2", href: "/classes" },
      { label: "overview.cards.atRisk", value: "5", href: "/subscriptions?status=at_risk", tone: "alert" },
    ]);
  });

  it("counts Active and At risk by exactly the named groups their cards link to", async () => {
    await renderRow();

    expect(countSubscriptions).toHaveBeenCalledTimes(2);
    expect(countSubscriptions).toHaveBeenCalledWith({ status: "active_or_expiring" });
    expect(countSubscriptions).toHaveBeenCalledWith({ status: "at_risk" });
  });

  it("reads the bounds once and hands the month dates and day instants to their counts", async () => {
    await renderRow();

    expect(getGymLocalPeriodBounds).toHaveBeenCalledTimes(1);
    expect(countMembersJoinedBetween).toHaveBeenCalledTimes(1);
    expect(countMembersJoinedBetween).toHaveBeenCalledWith("2026-09-01", "2026-10-01");
    expect(countClassSessionsBetween).toHaveBeenCalledTimes(1);
    expect(countClassSessionsBetween).toHaveBeenCalledWith("2026-09-09T23:00:00+00:00", "2026-09-10T23:00:00+00:00");
  });

  it("formats every figure with the request locale and translates in it", async () => {
    const tree = await renderRow("fr");

    expect(getServerTranslation).toHaveBeenCalledWith("fr");
    expect(card(tree, "overview.cards.activeMembers").value).toBe((1200).toLocaleString("fr"));
  });

  it("renders At risk in the default tone when it is zero -- a healthy gym gets no red number", async () => {
    subscriptionCounts.at_risk = { data: 0, error: null };

    const tree = await renderRow();

    expect(card(tree, "overview.cards.atRisk")).toMatchObject({ value: "0", tone: "default" });
  });

  it("renders a failed At risk count as Unavailable, in the default tone", async () => {
    subscriptionCounts.at_risk = FAILED;

    const tree = await renderRow();

    expect(card(tree, "overview.cards.atRisk")).toMatchObject({ value: "overview.cards.unavailable", tone: "default" });
    expect(card(tree, "overview.cards.activeMembers").value).toBe("1,200");
    expect(consoleError).toHaveBeenCalledWith("GymHealthRow: countSubscriptions(at_risk) failed -- boom");
  });

  it("degrades only the Active card when its count fails", async () => {
    subscriptionCounts.active_or_expiring = FAILED;

    const tree = await renderRow();

    expect(cards(tree).map((c) => c.value)).toEqual(["overview.cards.unavailable", "3", "2", "5"]);
    expect(consoleError).toHaveBeenCalledTimes(1);
  });

  it("on a failed bounds read, shows Unavailable on exactly New this month and Today's classes and never attempts their counts", async () => {
    getGymLocalPeriodBounds.mockResolvedValue(FAILED);

    const tree = await renderRow();

    expect(cards(tree).map((c) => c.value)).toEqual(["1,200", "overview.cards.unavailable", "overview.cards.unavailable", "5"]);
    expect(countMembersJoinedBetween).not.toHaveBeenCalled();
    expect(countClassSessionsBetween).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith("GymHealthRow: getGymLocalPeriodBounds failed -- boom");
  });

  it("degrades only New this month when the member count fails", async () => {
    countMembersJoinedBetween.mockResolvedValue(FAILED);

    const tree = await renderRow();

    expect(cards(tree).map((c) => c.value)).toEqual(["1,200", "overview.cards.unavailable", "2", "5"]);
  });

  it("degrades only Today's classes when the session count fails", async () => {
    countClassSessionsBetween.mockResolvedValue(FAILED);

    const tree = await renderRow();

    expect(cards(tree).map((c) => c.value)).toEqual(["1,200", "3", "overview.cards.unavailable", "5"]);
  });

  it("still renders all four cards when every read fails", async () => {
    subscriptionCounts = {};
    getGymLocalPeriodBounds.mockResolvedValue(FAILED);

    const tree = await renderRow();

    expect(cards(tree)).toHaveLength(4);
    expect(cards(tree).every((c) => c.value === "overview.cards.unavailable")).toBe(true);
    expect(card(tree, "overview.cards.atRisk").tone).toBe("default");
  });
});

describe("GymHealthRowSkeleton", () => {
  it("reserves four text-free tiles", () => {
    const { container } = render(<GymHealthRowSkeleton />);

    expect(container.textContent).toBe("");
    expect(container.querySelectorAll(".animate-pulse")).toHaveLength(4);
  });
});
