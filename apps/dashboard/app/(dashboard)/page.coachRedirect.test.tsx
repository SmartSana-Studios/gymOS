/**
 * Story 17.3 (AC #1, #2, #16): a Coach session on `/` is sent to the Coach
 * Portal, and nothing staff-shaped happens on the way. Asserted on the
 * element tree using layout.gymSwitchRemount.test.tsx's technique -- reach
 * through the page's <Suspense> to the async child and await it.
 *
 * `redirect` is mocked to THROW a sentinel, as the real one throws a
 * control-flow signal. A non-throwing `vi.fn()` would let execution fall
 * through into the Overview fetches, and "redirect was called" would pass
 * while the page still rendered staff content.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";

const REDIRECT_SENTINEL = new Error("redirect() sentinel");

const redirect = vi.fn<(url: string) => never>(() => {
  throw REDIRECT_SENTINEL;
});
vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirect(url),
}));

const getRequestLocale = vi.fn(async () => "en");
vi.mock("@/lib/i18n/get-request-locale", () => ({
  getRequestLocale: () => getRequestLocale(),
}));

vi.mock("@/lib/i18n/get-server-translation", () => ({
  getServerTranslation: vi.fn(async () => ({ t: (key: string) => key })),
}));

const getDashboardShellContext = vi.fn();
vi.mock("@/services/session", () => ({
  getDashboardShellContext: () => getDashboardShellContext(),
}));

const listActiveFrontDeskAlerts = vi.fn(async () => ({ data: { alerts: [], autoDismissMinutes: 30 }, error: null }));
vi.mock("@/services/frontDeskAlerts", () => ({
  listActiveFrontDeskAlerts: () => listActiveFrontDeskAlerts(),
}));

const canOfferMobileMoneyPayment = vi.fn(async () => false);
vi.mock("@/lib/featureFlags", () => ({
  canOfferMobileMoneyPayment: () => canOfferMobileMoneyPayment(),
}));

const getCurrentlyCheckedIn = vi.fn(async () => ({ data: { rows: [], total: 0, page: 1 }, error: null }));
vi.mock("@/services/attendance", () => ({
  getCurrentlyCheckedIn: () => getCurrentlyCheckedIn(),
}));

const listSubscriptions = vi.fn(async () => ({ data: { rows: [], total: 0 }, error: null }));
vi.mock("@/services/subscriptions", () => ({
  listSubscriptions: () => listSubscriptions(),
}));

const getRevenueMtd = vi.fn(async () => ({ data: 0, error: null }));
vi.mock("@/services/payments", () => ({
  getRevenueMtd: () => getRevenueMtd(),
}));

vi.mock("@/components/shared/FrontDeskAlertPanel", () => ({
  FrontDeskAlertPanel: () => null,
}));
vi.mock("./components/CheckedInTable", () => ({ CheckedInTable: () => null }));
vi.mock("./components/ExpiringTable", () => ({ ExpiringTable: () => null }));
vi.mock("./components/OverviewAutoRefresh", () => ({ OverviewAutoRefresh: () => null }));
vi.mock("./components/GymHealthRow", () => ({ GymHealthRow: () => null, GymHealthRowSkeleton: () => null }));

import OverviewPage from "./page";

type AsyncComponent = (props: unknown) => Promise<ReactElement>;

function shellFor(role: string) {
  return {
    data: { gymId: "gym-a", gymName: "Gym A", role, memberName: "Someone", mustChangePassword: false, availableGyms: [] },
    error: null,
    suspended: null,
  };
}

function outerBoundary() {
  return OverviewPage() as ReactElement<{ children: ReactElement; fallback: unknown }>;
}

/** Awaits the async child of the page's outermost <Suspense>. */
async function renderGate(): Promise<ReactElement> {
  const child = outerBoundary().props.children;
  return await (child.type as AsyncComponent)(child.props);
}

const OVERVIEW_FETCHES = {
  getRequestLocale,
  listActiveFrontDeskAlerts,
  canOfferMobileMoneyPayment,
  getCurrentlyCheckedIn,
  listSubscriptions,
  getRevenueMtd,
};

describe("(dashboard) Overview page — Coach redirect", () => {
  beforeEach(() => {
    redirect.mockClear();
    getDashboardShellContext.mockReset();
    for (const fetch of Object.values(OVERVIEW_FETCHES)) fetch.mockClear();
  });

  it("redirects a Coach to /coach/overview", async () => {
    getDashboardShellContext.mockResolvedValue(shellFor("coach"));

    await expect(renderGate()).rejects.toBe(REDIRECT_SENTINEL);
    expect(redirect).toHaveBeenCalledWith("/coach/overview");
  });

  it("decides the redirect before any other Overview fetch, so a Coach triggers none of them", async () => {
    getDashboardShellContext.mockResolvedValue(shellFor("coach"));

    await expect(renderGate()).rejects.toBe(REDIRECT_SENTINEL);
    for (const [name, fetch] of Object.entries(OVERVIEW_FETCHES)) {
      expect(fetch, name).not.toHaveBeenCalled();
    }
  });

  it("shows only a role-neutral skeleton while the role is unknown -- no stat-card grid or staff copy is flushed to a Coach", () => {
    const fallback = outerBoundary().props.fallback as ReactElement | null;
    // Not `null`: on a client-side navigation to `/` the shell read is not a
    // cache hit, and a null fallback blanked the content area for staff.
    expect(fallback).not.toBeNull();

    const { container } = render(fallback as ReactElement);
    expect(container.textContent).toBe("");
    expect(container.querySelector('[class*="grid-cols"]')).toBeNull();
  });

  it.each(["owner", "supervisor", "manager", "receptionist"])("does not redirect %s", async (role) => {
    getDashboardShellContext.mockResolvedValue(shellFor(role));

    const inner = (await renderGate()) as ReactElement<{ children: ReactElement; fallback: unknown }>;

    expect(redirect).not.toHaveBeenCalled();
    // Staff keep Story 17.1's AD-02 skeleton, one boundary further in -- a
    // different skeleton from the role-neutral one on the gate.
    expect(inner.props.fallback).not.toBeNull();
    expect((inner.props.fallback as ReactElement).type).not.toBe(
      (outerBoundary().props.fallback as ReactElement).type,
    );
    const data = inner.props.children;
    const tree = await (data.type as AsyncComponent)(data.props);
    expect(tree).toBeTruthy();
    expect(getCurrentlyCheckedIn).toHaveBeenCalledTimes(1);
  });

  it("does not redirect when there is no shell (the layout owns that case)", async () => {
    getDashboardShellContext.mockResolvedValue({ data: null, error: null, suspended: null });

    await renderGate();

    expect(redirect).not.toHaveBeenCalled();
  });
});
