/**
 * Story 27.3, UX AD-11 V1.8: the Entry column in both tables, [Check in a member] in the header (absent from the DOM for a Coach),
 * [Void] only for Manager and above (and support) on a voidable staff entry (never on a scan, a receptionist's screen, or a voided row),
 * its accessible name, and the voided Daily Log row (muted, "Voided" pill in the Check-out cell, who/when/why).
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/attendance",
  useSearchParams: () => new URLSearchParams("tab=checkedIn"),
}));
vi.mock("@/hooks/use-table-pagination", () => ({ useUrlPagination: () => ({}) }));
vi.mock("@/components/TablePagination", () => ({ TablePagination: () => null }));
vi.mock("@/components/shared/FrontDeskAlertPanel", () => ({ FrontDeskAlertPanel: () => null }));
vi.mock("./CheckInMemberModal", () => ({ CheckInMemberModal: () => <div data-testid="checkin-modal" /> }));
vi.mock("../actions", () => ({ voidStaffCheckInAction: vi.fn(), checkOutMemberAction: vi.fn() }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) => (vars ? `${key} ${JSON.stringify(vars)}` : key),
    i18n: { language: "en" },
  }),
}));

import { AttendancePageClient } from "./AttendancePageClient";

const base = { consumedSession: null, earnedStamp: null };
const openRows = [
  { attendanceId: "a1", memberId: "m1", name: "Ange T.", checkedInAt: "2026-11-15T07:02:00.000Z", status: "active", deactivatedAt: null, source: "staff", enteredByLabel: "Brice N.", voidable: true, ...base },
  { attendanceId: "a2", memberId: "m2", name: "Jean B.", checkedInAt: "2026-11-15T06:40:00.000Z", status: "active", deactivatedAt: null, source: "qr", enteredByLabel: null, voidable: false, ...base },
  { attendanceId: "a3", memberId: "m3", name: "Paul E.", checkedInAt: "2026-11-15T06:30:00.000Z", status: "active", deactivatedAt: null, source: "staff", enteredByLabel: null, voidable: false, ...base },
  { attendanceId: "a4", memberId: "m4", name: "Sup M.", checkedInAt: "2026-11-15T06:20:00.000Z", status: "active", deactivatedAt: null, source: "staff", enteredByLabel: "GymOS Support", voidable: true, ...base },
] as never;
const logRows = [
  { id: "a1", memberId: "m1", memberName: "Ange T.", checkedInAt: "2026-11-15T07:02:00.000Z", checkedOutAt: null, source: "staff", enteredByLabel: "Brice N.", voidable: true, voidedAt: null, voidedByLabel: null, voidReason: null, ...base },
  { id: "a5", memberId: "m5", memberName: "Paul E.", checkedInAt: "2026-11-15T06:50:00.000Z", checkedOutAt: "2026-11-15T06:51:00.000Z", source: "staff", enteredByLabel: "Aicha M.", voidable: false, voidedAt: "2026-11-15T06:55:00.000Z", voidedByLabel: "Brice N.", voidReason: "wrong member", ...base },
  { id: "a6", memberId: "m6", memberName: "Amara K.", checkedInAt: "2026-11-15T08:14:00.000Z", checkedOutAt: "2026-11-15T10:02:00.000Z", source: "qr", enteredByLabel: null, voidable: false, ...base },
] as never;

function renderPage(role: string, tab: "checkedIn" | "log" = "checkedIn") {
  window.history.replaceState({}, "", `/attendance?tab=${tab}`);
  return render(
    <AttendancePageClient
      currentlyCheckedIn={openRows}
      checkedInTotal={4}
      checkedInPage={1}
      checkedInPageSize={10}
      todayCount={4}
      logRows={logRows}
      logTotal={3}
      page={1}
      pageSize={10}
      from="2026-11-15"
      to="2026-11-15"
      memberSearch=""
      gymId="g1"
      initialAlerts={[]}
      autoDismissMinutes={30}
      mobileMoneyEnabled={false}
      role={role}
    />,
  );
}

function rowOf(name: string) {
  return screen.getByText(name).closest("tr") as HTMLElement;
}

describe("AttendancePageClient staff entry (27.3)", () => {
  it.each(["receptionist", "manager", "supervisor", "owner", "support"])("%s sees [Check in a member] in the header", (role) => {
    renderPage(role);
    expect(screen.getByRole("button", { name: "attendance.checkIn.action" })).toBeInTheDocument();
  });

  it("a Coach has no [Check in a member] in the DOM at all", () => {
    renderPage("coach");
    expect(screen.queryByRole("button", { name: "attendance.checkIn.action" })).toBeNull();
  });

  it("opens the modal", async () => {
    renderPage("receptionist");
    await userEvent.setup().click(screen.getByRole("button", { name: "attendance.checkIn.action" }));
    expect(screen.getByTestId("checkin-modal")).toBeInTheDocument();
  });

  it("Entry column, Currently Checked In: QR scan, By staff with the name, By staff alone when the name did not resolve, GymOS Support", () => {
    renderPage("receptionist");
    expect(screen.getAllByRole("columnheader", { name: "attendance.log.entry" })).toHaveLength(1);
    expect(within(rowOf("Jean B.")).getByText("attendance.log.entryScan")).toBeInTheDocument();
    const ange = rowOf("Ange T.");
    expect(within(ange).getByText("attendance.log.byStaff")).toBeInTheDocument();
    expect(within(ange).getByText("· Brice N.")).toHaveClass("hidden", "lg:inline");
    const paul = rowOf("Paul E.");
    expect(within(paul).getByText("attendance.log.byStaff")).toBeInTheDocument();
    expect(within(paul).queryByText(/·/)).toBeNull();
    expect(within(rowOf("Sup M.")).getByText("· GymOS Support")).toBeInTheDocument();
  });

  it("a Receptionist sees no [Void] anywhere", () => {
    renderPage("receptionist");
    expect(screen.queryAllByRole("button", { name: (n) => n.startsWith("attendance.void.actionAria") })).toHaveLength(0);
  });

  it("a Manager sees [Void] next to [Check Out] only on a voidable staff entry, with the member and time in its name", () => {
    renderPage("manager");
    const buttons = screen.getAllByRole("button", { name: (n) => n.startsWith("attendance.void.actionAria") });
    expect(buttons).toHaveLength(2); // Ange T. and the support entry; never the scan, never the unresolved row (not voidable)
    expect(within(rowOf("Ange T.")).getByRole("button", { name: (n) => n.startsWith("attendance.void.actionAria") && n.includes("Ange T.") && /"time":"\d\d:\d\d"/.test(n) })).toBeInTheDocument();
    expect(within(rowOf("Ange T.")).getByRole("button", { name: "attendance.checkOutButton" })).toBeInTheDocument();
    expect(within(rowOf("Jean B.")).queryByRole("button", { name: (n) => n.startsWith("attendance.void.actionAria") })).toBeNull();
  });

  it("support sees [Void] too, and a click opens the Void modal for that row", async () => {
    renderPage("support");
    await userEvent.setup().click(within(rowOf("Ange T.")).getByRole("button", { name: (n) => n.startsWith("attendance.void.actionAria") }));
    expect(screen.getByText((c) => c.startsWith("attendance.void.body "))).toBeInTheDocument();
    expect(screen.getByText((c) => c.startsWith("attendance.void.supportAbout "))).toBeInTheDocument();
  });

  it("Daily Log: Entry column, [Void] alone on a voidable row, a voided row muted with the Voided pill and its detail", async () => {
    renderPage("manager", "log");
    await userEvent.setup().click(screen.getByRole("tab", { name: "attendance.tabs.log" }));
    const voided = rowOf("Paul E.");
    expect(voided).toHaveAttribute("data-voided", "true");
    expect(voided).toHaveClass("text-muted-foreground");
    expect(within(voided).getByText("attendance.log.voided")).toBeInTheDocument();
    expect(within(voided).getAllByText((c) => c.startsWith("attendance.log.voidedDetail ") && c.includes("wrong member") && c.includes("Brice N."))).not.toHaveLength(0);
    expect(within(voided).queryByRole("button", { name: (n) => n.startsWith("attendance.void.actionAria") })).toBeNull();
    expect(within(rowOf("Ange T.")).getByRole("button", { name: (n) => n.startsWith("attendance.void.actionAria") })).toBeInTheDocument();
    expect(within(rowOf("Amara K.")).getByText("attendance.log.entryScan")).toBeInTheDocument();
  });
});
