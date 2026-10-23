/**
 * Story 23.10: the Owner review queue and the "created by GymOS Support" tag on the staff list.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const clearSupportReviewAction = vi.fn();
vi.mock("next/link", () => ({ default: ({ children }: { children: React.ReactNode }) => <a>{children}</a> }));
vi.mock("../actions", () => ({
  getStaffList: vi.fn(),
  resendStaffTempPasswordAction: vi.fn(),
  clearSupportReviewAction: (...a: unknown[]) => clearSupportReviewAction(...a),
}));
vi.mock("./AddStaffModal", () => ({ AddStaffModal: () => null }));
vi.mock("./EditStaffModal", () => ({ EditStaffModal: () => null }));
vi.mock("./DeactivateStaffDialog", () => ({ DeactivateStaffDialog: () => null }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string, o?: { name?: string }) => (o?.name ? `${key}:${o.name}` : key), i18n: { language: "en" } }),
}));

import { StaffPageClient } from "./StaffPageClient";
import type { StaffListRow, SupportReviewRow } from "@/services/staff";

const staff = [
  { id: "m1", name: "Coach One", role: "coach", status: "active", phone: null, createdBySupport: true },
  { id: "m2", name: "Manager Two", role: "manager", status: "active", phone: null, createdBySupport: false },
] as StaffListRow[];
const queue: SupportReviewRow[] = [{ memberId: "m1", name: "Coach One", role: "coach", flaggedAt: "2026-10-21T10:00:00Z" }];

describe("StaffPageClient support review", () => {
  beforeEach(() => clearSupportReviewAction.mockReset());

  it("tags only the staff GymOS Support created", () => {
    render(<StaffPageClient initialStaff={staff} role="owner" callerMemberId={null} />);
    const tags = screen.getAllByTestId("created-by-support-tag");
    expect(tags).toHaveLength(1);
    expect(tags[0].textContent).toBe("staff.supportTag");
  });

  it("lists the review queue for the Owner and removes a person when kept, without deactivating anyone", async () => {
    clearSupportReviewAction.mockResolvedValue({ data: { ok: true }, error: null });
    render(<StaffPageClient initialStaff={staff} role="owner" callerMemberId={null} initialReviewQueue={queue} />);
    expect(screen.getByTestId("support-review-queue")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "staff.supportReview.keep" }));
    await waitFor(() => expect(screen.queryByTestId("support-review-queue")).toBeNull());
    expect(clearSupportReviewAction).toHaveBeenCalledWith("m1");
    // the person is still on the list
    expect(screen.getAllByText("Coach One").length).toBeGreaterThan(0);
  });

  it("keeps the person in the queue and says so when the save fails", async () => {
    clearSupportReviewAction.mockResolvedValue({ data: null, error: { code: "unknown", message: "boom" } });
    render(<StaffPageClient initialStaff={staff} role="owner" callerMemberId={null} initialReviewQueue={queue} />);
    fireEvent.click(screen.getByRole("button", { name: "staff.supportReview.keep" }));
    await waitFor(() => expect(screen.getByText("boom")).toBeTruthy());
    expect(screen.getByTestId("support-review-queue")).toBeTruthy();
  });

  it("shows no queue when there is none", () => {
    render(<StaffPageClient initialStaff={staff} role="owner" callerMemberId={null} initialReviewQueue={[]} />);
    expect(screen.queryByTestId("support-review-queue")).toBeNull();
  });
});
