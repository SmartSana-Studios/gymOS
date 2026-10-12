/**
 * Story 19.10: the AD-22 page's server composition -- role gate, URL param
 * fallbacks, which list each tab reads, and the 42501 mapping.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

vi.mock("@/lib/i18n/get-request-locale", () => ({ getRequestLocale: vi.fn(async () => "en") }));
vi.mock("@/lib/i18n/get-server-translation", () => ({
  getServerTranslation: vi.fn(async () => ({ t: (key: string) => key })),
}));

const getDashboardShellContext = vi.fn();
vi.mock("@/services/session", () => ({ getDashboardShellContext: () => getDashboardShellContext() }));

const getGuestSessionsSummary = vi.fn();
const listPaidGuestSessions = vi.fn();
const listBlockedSessionAttempts = vi.fn();
const listFreeGuestSessions = vi.fn();
vi.mock("@/services/guestSessions", () => ({
  getGuestSessionsSummary: (...a: unknown[]) => getGuestSessionsSummary(...a),
  listPaidGuestSessions: (...a: unknown[]) => listPaidGuestSessions(...a),
  listBlockedSessionAttempts: (...a: unknown[]) => listBlockedSessionAttempts(...a),
  listFreeGuestSessions: (...a: unknown[]) => listFreeGuestSessions(...a),
}));

vi.mock("./components/GuestSessionsPageClient", () => ({
  GuestSessionsPageClient: function GuestSessionsPageClient() {
    return null;
  },
}));
vi.mock("./loading", () => ({ default: function Loading() { return null; } }));

import GuestSessionsPage from "./page";

async function render(search: Record<string, string> = {}) {
  const boundary = GuestSessionsPage({ searchParams: Promise.resolve(search) }) as ReactElement<{ children: ReactElement }>;
  const child = boundary.props.children;
  return (await (child.type as (p: unknown) => Promise<ReactElement>)(child.props)) as ReactElement<Record<string, unknown>>;
}

const summary = { paid: 1, blocked: 0, blockedMembers: 0, free: 0 };

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  getDashboardShellContext.mockReset().mockResolvedValue({ data: { role: "manager" }, error: null });
  getGuestSessionsSummary.mockReset().mockResolvedValue({ data: summary, error: null });
  listPaidGuestSessions.mockReset().mockResolvedValue({ data: { rows: [], total: 0 }, error: null });
  listBlockedSessionAttempts.mockReset().mockResolvedValue({ data: { rows: [], total: 0 }, error: null });
  listFreeGuestSessions.mockReset().mockResolvedValue({ data: { rows: [], total: 0 }, error: null });
});

describe("guest-sessions page", () => {
  it.each(["receptionist", "coach"])("shows %s the permission state without reading anything", async (role) => {
    getDashboardShellContext.mockResolvedValue({ data: { role }, error: null });
    const tree = await render();
    expect(tree.props.state).toBe("forbidden");
    expect(tree.props.message).toBe("guestSessions.permissionDenied");
    expect(getGuestSessionsSummary).not.toHaveBeenCalled();
    expect(listPaidGuestSessions).not.toHaveBeenCalled();
  });

  it("maps a refused read (42501) to the permission state", async () => {
    getGuestSessionsSummary.mockResolvedValue({ data: null, error: { code: "forbidden", message: "x" } });
    expect((await render()).props.state).toBe("forbidden");
  });

  it("falls back to today and paid for unknown params", async () => {
    const tree = await render({ tab: "nope", period: "x", page: "-3" });
    expect(tree.props).toMatchObject({ state: "ready", tab: "paid", period: "today", page: 1 });
    expect(listPaidGuestSessions).toHaveBeenCalledWith({
      period: "today",
      page: 1,
      refundedAfterUseOnly: false,
      groupByRecorder: true,
    });
  });

  it("reads only the active tab's list, with the Paid filters from the URL", async () => {
    await render({ tab: "paid", period: "month", group: "none", refunded: "1", page: "2" });
    expect(listPaidGuestSessions).toHaveBeenCalledWith({
      period: "month",
      page: 2,
      refundedAfterUseOnly: true,
      groupByRecorder: false,
    });
    expect(listBlockedSessionAttempts).not.toHaveBeenCalled();

    await render({ tab: "blocked", period: "month" });
    expect(listBlockedSessionAttempts).toHaveBeenCalledWith({ period: "month", page: 1 });

    await render({ tab: "free" });
    expect(listFreeGuestSessions).toHaveBeenCalledWith({ period: "today", page: 1 });
  });

  it("shows the page error when a read fails", async () => {
    listPaidGuestSessions.mockResolvedValue({ data: null, error: { code: "unknown", message: "boom" } });
    const tree = await render();
    expect(tree.props.state).toBe("error");
    expect(console.error).toHaveBeenCalled();
  });
});
