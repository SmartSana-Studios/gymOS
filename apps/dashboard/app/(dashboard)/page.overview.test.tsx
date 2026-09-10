/**
 * Story 17.1: the AD-02 Overview's server-side composition. Asserted on the
 * element tree `OverviewData` returns, using layout.gymSwitchRemount.test.tsx's
 * technique -- reach through the page's <Suspense> to the async child and
 * await it; no renderer needed. The client tables, the auto-refresh and the
 * alert panel are stubbed so only this file's own decisions are under test:
 *
 *  - one service call per card+table pair; the card gets `total`, the table
 *    gets at most 10 rows (AC #2);
 *  - "Expiring this week" reads the `expiring_soon` status (AC #3);
 *  - the click-through targets (AC #8);
 *  - every number is formatted with the request locale, and a negative
 *    revenue figure keeps its minus sign (AC #16);
 *  - one failed read degrades only its own surface (AC #11);
 *  - the alert panel still mounts whenever `shell` resolves (AC #10);
 *  - the `overview.body` placeholder is gone (AC #1).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { isValidElement, type ReactElement, type ReactNode } from "react";

let locale: "en" | "fr" = "en";

vi.mock("@/lib/i18n/get-request-locale", () => ({
  getRequestLocale: vi.fn(async () => locale),
}));

vi.mock("@/lib/i18n/get-server-translation", () => ({
  getServerTranslation: vi.fn(async () => ({ t: (key: string) => key })),
}));

const getDashboardShellContext = vi.fn();
vi.mock("@/services/session", () => ({
  getDashboardShellContext: () => getDashboardShellContext(),
}));

const listActiveFrontDeskAlerts = vi.fn();
vi.mock("@/services/frontDeskAlerts", () => ({
  listActiveFrontDeskAlerts: () => listActiveFrontDeskAlerts(),
}));

vi.mock("@/lib/featureFlags", () => ({
  canOfferMobileMoneyPayment: vi.fn(async () => true),
}));

const getCurrentlyCheckedIn = vi.fn();
vi.mock("@/services/attendance", () => ({
  getCurrentlyCheckedIn: (...args: unknown[]) => getCurrentlyCheckedIn(...args),
}));

const listSubscriptions = vi.fn();
vi.mock("@/services/subscriptions", () => ({
  listSubscriptions: (...args: unknown[]) => listSubscriptions(...args),
}));

const getRevenueMtd = vi.fn();
vi.mock("@/services/payments", () => ({
  getRevenueMtd: (...args: unknown[]) => getRevenueMtd(...args),
}));

vi.mock("@/components/shared/FrontDeskAlertPanel", () => ({
  FrontDeskAlertPanel: function FrontDeskAlertPanel() {
    return null;
  },
}));

vi.mock("./components/CheckedInTable", () => ({
  CheckedInTable: function CheckedInTable() {
    return null;
  },
}));

vi.mock("./components/ExpiringTable", () => ({
  ExpiringTable: function ExpiringTable() {
    return null;
  },
}));

vi.mock("./components/OverviewAutoRefresh", () => ({
  OverviewAutoRefresh: function OverviewAutoRefresh() {
    return null;
  },
}));

import OverviewPage from "./page";
import { StatCard } from "@/components/ui/stat-card";
import { FrontDeskAlertPanel } from "@/components/shared/FrontDeskAlertPanel";
import { CheckedInTable } from "./components/CheckedInTable";
import { ExpiringTable } from "./components/ExpiringTable";
import { OverviewAutoRefresh } from "./components/OverviewAutoRefresh";

function checkedInRows(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    memberId: `member-${i}`,
    name: `Member ${i}`,
    checkedInAt: "2026-09-10T08:00:00.000Z",
    status: "active" as const,
    deactivatedAt: null,
  }));
}

function expiringRows(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    subscriptionId: `sub-${i}`,
    memberId: `member-${i}`,
    memberName: `Member ${i}`,
    memberPhone: null,
    planId: "plan-1",
    planName: "Monthly",
    planType: "monthly",
    status: "expiring_soon" as const,
    startDate: "2026-08-15",
    expiryDate: "2026-09-15",
  }));
}

/**
 * Story 17.3 split the page into two boundaries: the outer one reads the shell
 * and redirects a Coach (page.coachRedirect.test.tsx), the inner one holds the
 * Overview itself. Both async children are awaited in turn.
 */
async function renderOverviewData(): Promise<ReactElement> {
  const awaitChild = async (boundary: ReactElement<{ children: ReactElement }>) => {
    const child = boundary.props.children;
    return (await (child.type as (props: unknown) => Promise<ReactElement>)(child.props)) as ReactElement<{
      children: ReactElement;
    }>;
  };
  const outer = OverviewPage() as ReactElement<{ children: ReactElement }>;
  return await awaitChild(await awaitChild(outer));
}

function findAll(node: ReactNode, type: unknown): ReactElement[] {
  if (Array.isArray(node)) return node.flatMap((child) => findAll(child, type));
  if (!isValidElement(node)) return [];
  const own = node.type === type ? [node] : [];
  return [...own, ...findAll((node.props as { children?: ReactNode }).children, type)];
}

function textContent(node: ReactNode): string[] {
  if (typeof node === "string") return [node];
  if (Array.isArray(node)) return node.flatMap(textContent);
  if (!isValidElement(node)) return [];
  return textContent((node.props as { children?: ReactNode }).children);
}

type CardProps = { label: string; value: string; href: string; tone?: string };

function cards(tree: ReactElement): CardProps[] {
  return findAll(tree, StatCard).map((el) => el.props as CardProps);
}

function card(tree: ReactElement, label: string): CardProps {
  const found = cards(tree).find((c) => c.label === label);
  if (!found) throw new Error(`no StatCard labelled ${label}`);
  return found;
}

describe("(dashboard) Overview page", () => {
  beforeEach(() => {
    locale = "en";
    getDashboardShellContext.mockReset().mockResolvedValue({
      data: { gymId: "gym-a", gymName: "Gym A", role: "owner", memberName: "Owner", mustChangePassword: false, availableGyms: [] },
      error: null,
      suspended: null,
    });
    listActiveFrontDeskAlerts.mockReset().mockResolvedValue({ data: { alerts: [], autoDismissMinutes: 30 }, error: null });
    getCurrentlyCheckedIn.mockReset().mockResolvedValue({ data: { rows: checkedInRows(12), total: 57, page: 1 }, error: null });
    listSubscriptions.mockReset().mockResolvedValue({ data: { rows: expiringRows(25), total: 31 }, error: null });
    getRevenueMtd.mockReset().mockResolvedValue({ data: 1234567, error: null });
  });

  it("renders the three AD-02 cards, in order, with their full totals and click-through targets", async () => {
    const tree = await renderOverviewData();

    expect(cards(tree)).toEqual([
      { label: "overview.cards.checkedInNow", value: "57", href: "/attendance" },
      { label: "overview.cards.expiringThisWeek", value: "31", href: "/subscriptions?status=expiring_soon&sort=expiry" },
      { label: "overview.cards.revenueThisMonth", value: "XAF 1,234,567", href: "/payments" },
    ]);
  });

  it("feeds each card and its table from ONE service call, the table capped at 10 rows", async () => {
    const tree = await renderOverviewData();

    expect(getCurrentlyCheckedIn).toHaveBeenCalledTimes(1);
    expect(listSubscriptions).toHaveBeenCalledTimes(1);
    expect(getRevenueMtd).toHaveBeenCalledTimes(1);

    const [checkedIn] = findAll(tree, CheckedInTable);
    const [expiring] = findAll(tree, ExpiringTable);
    expect((checkedIn.props as { rows: unknown[] }).rows).toHaveLength(10);
    expect((expiring.props as { rows: unknown[] }).rows).toHaveLength(10);
  });

  it("keeps the checked-in service's own order when slicing", async () => {
    const tree = await renderOverviewData();
    const [checkedIn] = findAll(tree, CheckedInTable);

    expect((checkedIn.props as { rows: { memberId: string }[] }).rows.map((r) => r.memberId)).toEqual(
      checkedInRows(10).map((r) => r.memberId),
    );
  });

  it("reads 'expiring this week' from the expiring_soon status, never a date filter, soonest expiry first", async () => {
    await renderOverviewData();

    // `sort: "expiry"` on the same single call: the service defaults to name
    // order, and the table keeps only the first 10 rows.
    expect(listSubscriptions).toHaveBeenCalledWith({ status: "expiring_soon", sort: "expiry" });
  });

  it("formats every card number with the request locale", async () => {
    locale = "fr";
    getCurrentlyCheckedIn.mockResolvedValue({ data: { rows: [], total: 1200, page: 1 }, error: null });

    const tree = await renderOverviewData();

    expect(card(tree, "overview.cards.checkedInNow").value).toBe((1200).toLocaleString("fr"));
    expect(card(tree, "overview.cards.revenueThisMonth").value).toBe(`XAF ${(1234567).toLocaleString("fr")}`);
  });

  it("renders a negative revenue figure with its minus sign rather than clamping it", async () => {
    getRevenueMtd.mockResolvedValue({ data: -1500, error: null });

    const tree = await renderOverviewData();

    expect(card(tree, "overview.cards.revenueThisMonth").value).toBe("XAF -1,500");
  });

  it("degrades only the revenue card when the revenue aggregate fails", async () => {
    getRevenueMtd.mockResolvedValue({ data: null, error: { code: "unknown", message: "boom" } });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const tree = await renderOverviewData();

    expect(card(tree, "overview.cards.revenueThisMonth").value).toBe("overview.cards.unavailable");
    expect(card(tree, "overview.cards.checkedInNow").value).toBe("57");
    const [checkedIn] = findAll(tree, CheckedInTable);
    expect(checkedIn.props).toMatchObject({ loadError: false });
    expect((checkedIn.props as { rows: unknown[] }).rows).toHaveLength(10);
  });

  it("degrades only the checked-in card and table when that read fails", async () => {
    getCurrentlyCheckedIn.mockResolvedValue({ data: null, error: { code: "unknown", message: "boom" } });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const tree = await renderOverviewData();

    expect(card(tree, "overview.cards.checkedInNow").value).toBe("overview.cards.unavailable");
    expect(card(tree, "overview.cards.revenueThisMonth").value).toBe("XAF 1,234,567");
    expect(findAll(tree, CheckedInTable)[0].props).toMatchObject({ rows: [], loadError: true });
    expect(findAll(tree, ExpiringTable)[0].props).toMatchObject({ loadError: false });
  });

  it("degrades only the expiring card and table when that read fails", async () => {
    listSubscriptions.mockResolvedValue({ data: null, error: { code: "unknown", message: "boom" } });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const tree = await renderOverviewData();

    expect(card(tree, "overview.cards.expiringThisWeek").value).toBe("overview.cards.unavailable");
    expect(findAll(tree, ExpiringTable)[0].props).toMatchObject({ rows: [], loadError: true });
    expect(findAll(tree, CheckedInTable)[0].props).toMatchObject({ loadError: false });
  });

  it("still mounts the alert panel when the alerts fetch fails, as Story 4.6 shipped it", async () => {
    listActiveFrontDeskAlerts.mockResolvedValue({ data: null, error: { code: "unknown", message: "boom" } });

    const tree = await renderOverviewData();
    const [panel] = findAll(tree, FrontDeskAlertPanel);

    expect(panel.props).toEqual({
      gymId: "gym-a",
      initialAlerts: [],
      autoDismissMinutes: 30,
      mobileMoneyEnabled: true,
    });
  });

  it("threads mobileMoneyEnabled to the expiring table for its Renew modal", async () => {
    const tree = await renderOverviewData();

    expect(findAll(tree, ExpiringTable)[0].props).toMatchObject({ mobileMoneyEnabled: true });
  });

  it("mounts the 60s auto-refresh", async () => {
    const tree = await renderOverviewData();

    expect(findAll(tree, OverviewAutoRefresh)).toHaveLength(1);
  });

  it("no longer renders the overview.body placeholder", async () => {
    const tree = await renderOverviewData();

    expect(textContent(tree)).not.toContain("overview.body");
    expect(textContent(tree)).toContain("overview.title");
  });
});
