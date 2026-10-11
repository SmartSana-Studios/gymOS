/**
 * Story 19.9b review: the attendance page hands the signed-in role to
 * `AttendancePageClient`, which threads it to the front-desk alert panel and
 * from there to the Record Session Payment panel (Bank Transfer gate, record
 * action visibility). The client tests inject `role` themselves, so without
 * this file dropping `role={shell.role}` would leave the suite green.
 *
 * Asserted on the element tree the async child returns, using
 * members/page.test.tsx's technique.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

vi.mock("@/lib/i18n/get-request-locale", () => ({
  getRequestLocale: vi.fn(async () => "en"),
}));
vi.mock("@/lib/i18n/get-server-translation", () => ({
  getServerTranslation: vi.fn(async () => ({ t: (key: string) => key })),
}));

const getCurrentlyCheckedIn = vi.fn();
const getTodayAttendanceCount = vi.fn();
const listAttendanceLog = vi.fn();
vi.mock("@/services/attendance", () => ({
  ATTENDANCE_LOG_PAGE_SIZE: 10,
  getCurrentlyCheckedIn: (...args: unknown[]) => getCurrentlyCheckedIn(...args),
  getTodayAttendanceCount: (...args: unknown[]) => getTodayAttendanceCount(...args),
  listAttendanceLog: (...args: unknown[]) => listAttendanceLog(...args),
  resolveDateParam: (_value: unknown, fallback: string) => fallback,
  todayUtcDate: () => "2026-10-11",
}));

const getDashboardShellContext = vi.fn();
vi.mock("@/services/session", () => ({
  getDashboardShellContext: (...args: unknown[]) => getDashboardShellContext(...args),
}));

const listActiveFrontDeskAlerts = vi.fn();
vi.mock("@/services/frontDeskAlerts", () => ({
  listActiveFrontDeskAlerts: (...args: unknown[]) => listActiveFrontDeskAlerts(...args),
}));

vi.mock("@/lib/featureFlags", () => ({
  canOfferMobileMoneyPayment: vi.fn(async () => false),
}));

vi.mock("./components/AttendancePageClient", () => ({
  AttendancePageClient: function AttendancePageClient() {
    return null;
  },
}));
vi.mock("./loading", () => ({
  default: function AttendanceLoading() {
    return null;
  },
}));

import AttendancePage from "./page";
import { AttendancePageClient } from "./components/AttendancePageClient";

async function renderAttendanceData(): Promise<ReactElement<Record<string, unknown>>> {
  const boundary = AttendancePage({ searchParams: Promise.resolve({}) }) as ReactElement<{
    children: ReactElement;
  }>;
  const child = boundary.props.children;
  return (await (child.type as (props: unknown) => Promise<ReactElement>)(child.props)) as ReactElement<
    Record<string, unknown>
  >;
}

describe("attendance page", () => {
  beforeEach(() => {
    getCurrentlyCheckedIn.mockReset().mockResolvedValue({ data: { rows: [], total: 0, page: 1 }, error: null });
    getTodayAttendanceCount.mockReset().mockResolvedValue({ count: 0, error: null });
    listAttendanceLog.mockReset().mockResolvedValue({ data: { rows: [], total: 0, page: 1 }, error: null });
    listActiveFrontDeskAlerts.mockReset().mockResolvedValue({ data: { alerts: [], autoDismissMinutes: 30 } });
    getDashboardShellContext.mockReset().mockResolvedValue({
      data: { gymId: "gym-a", gymName: "Gym A", role: "manager" },
      error: null,
    });
  });

  it("hands the signed-in role and gym to AttendancePageClient", async () => {
    const tree = await renderAttendanceData();

    expect(tree.type).toBe(AttendancePageClient);
    expect(tree.props.role).toBe("manager");
    expect(tree.props.gymId).toBe("gym-a");
  });
});
