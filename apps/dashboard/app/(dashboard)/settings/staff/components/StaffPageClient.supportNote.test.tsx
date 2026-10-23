/**
 * Epic 23 retro: a GymOS Support person cannot read the staff list, so the toast after they add someone says where the person went.
 * An Owner's toast is unchanged.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("next/link", () => ({ default: ({ children }: { children: React.ReactNode }) => <a>{children}</a> }));
vi.mock("../actions", () => ({
  getStaffList: vi.fn(async () => ({ data: [], error: null })),
  resendStaffTempPasswordAction: vi.fn(),
  clearSupportReviewAction: vi.fn(),
}));
vi.mock("./AddStaffModal", () => ({
  AddStaffModal: ({ onCreated }: { onCreated: (tempPassword: string | null, smsSent: boolean, phone: string, isExistingAccount: boolean) => void }) => (
    <button type="button" data-testid="simulate-created" onClick={() => onCreated("pw", true, "+237600000001", false)} />
  ),
}));
vi.mock("./EditStaffModal", () => ({ EditStaffModal: () => null }));
vi.mock("./DeactivateStaffDialog", () => ({ DeactivateStaffDialog: () => null }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));

import { StaffPageClient } from "./StaffPageClient";

async function created(role: "support" | "owner") {
  render(<StaffPageClient initialStaff={[]} role={role} callerMemberId={null} />);
  fireEvent.click(screen.getByTestId("simulate-created"));
  await waitFor(() => expect(screen.getByText(/staff\.toast\.createdSms/)).toBeTruthy());
  return screen.getByText(/staff\.toast\.createdSms/).textContent ?? "";
}

describe("StaffPageClient toast after adding staff", () => {
  it("tells a GymOS Support person that they cannot see the list and that the Owner reviews the account", async () => {
    expect(await created("support")).toContain("staff.toast.supportNote");
  });

  it("leaves an Owner's toast unchanged", async () => {
    expect(await created("owner")).not.toContain("staff.toast.supportNote");
  });
});
