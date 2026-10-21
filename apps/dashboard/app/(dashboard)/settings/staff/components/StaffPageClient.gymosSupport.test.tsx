/**
 * Story 23.3: the fixed "GymOS Support" row on the staff list.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("next/link", () => ({ default: ({ children }: { children: React.ReactNode }) => <a>{children}</a> }));
vi.mock("../actions", () => ({ getStaffList: vi.fn(), resendStaffTempPasswordAction: vi.fn() }));
vi.mock("./AddStaffModal", () => ({ AddStaffModal: () => null }));
vi.mock("./EditStaffModal", () => ({ EditStaffModal: () => null }));
vi.mock("./DeactivateStaffDialog", () => ({ DeactivateStaffDialog: () => null }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));

import { StaffPageClient } from "./StaffPageClient";
import type { StaffListRow } from "@/services/staff";

function rows(n: number): StaffListRow[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `m${i}`,
    name: `Staff ${i}`,
    role: "coach",
    status: "active",
    phone: null,
  })) as unknown as StaffListRow[];
}

function renderClient(staff: StaffListRow[], show: boolean) {
  return render(<StaffPageClient initialStaff={staff} role="owner" callerMemberId={null} showGymosSupportRow={show} />);
}

describe("StaffPageClient GymOS Support row", () => {
  it("shows the row when the flag is on and hides it when off", () => {
    const { unmount } = renderClient(rows(2), true);
    expect(screen.getByTestId("gymos-support-row")).toBeTruthy();
    unmount();
    renderClient(rows(2), false);
    expect(screen.queryByTestId("gymos-support-row")).toBeNull();
  });

  it("shows the row on page 1 only", () => {
    renderClient(rows(7), true);
    expect(screen.getAllByTestId("gymos-support-row")).toHaveLength(1);
    fireEvent.click(screen.getAllByRole("button", { name: /next/i })[0]);
    expect(screen.queryByTestId("gymos-support-row")).toBeNull();
  });

  it("shows the row (not the empty state) when it is the only entry", () => {
    renderClient([], true);
    expect(screen.getByTestId("gymos-support-row")).toBeTruthy();
    expect(screen.queryByText("staff.emptyNoStaff")).toBeNull();
  });

  it("keeps the empty state when there is no row and no staff", () => {
    renderClient([], false);
    expect(screen.getByText("staff.emptyNoStaff")).toBeTruthy();
  });
});
