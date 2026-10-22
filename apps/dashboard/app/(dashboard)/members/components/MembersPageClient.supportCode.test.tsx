/** Story 23-6c: the page passes isSupport to the waive dialog, so only a support session sees the authenticator code field. */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../actions", () => ({ sendMemberInvite: vi.fn(), exportMembersCsv: vi.fn() }));
vi.mock("@/app/(dashboard)/payments/actions", () => ({ waiveRegistrationFeeAction: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/members",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));
vi.mock("./MemberModal", () => ({ MemberModal: () => null }));
vi.mock("./DeactivateMemberDialog", () => ({ DeactivateMemberDialog: () => null }));
vi.mock("./CsvImportModal", () => ({ CsvImportModal: () => null }));
vi.mock("./InviteMemberModal", () => ({ InviteMemberModal: () => null }));
vi.mock("./CollectRegistrationFeeDialog", () => ({ CollectRegistrationFeeDialog: () => null }));
vi.mock("./VoidRegistrationFeeDialog", () => ({ VoidRegistrationFeeDialog: () => null }));
vi.mock("./AssignInitialPlanDialog", () => ({ AssignInitialPlanDialog: () => null }));

const awaiting = {
  id: "m-awaiting", name: "Awaiting Ann", phone: "+237680811041", email: null, dob: null, photoUrl: null, emergencyContact: null,
  planId: null, planName: null, planType: null, status: "no_active_plan" as const, expiryDate: null, joinDate: "2026-01-01",
  deactivatedAt: null, registrationFeeSettledAt: null,
};

async function openWaive(role: "support" | "owner") {
  const { MembersPageClient } = await import("./MembersPageClient");
  render(
    <MembersPageClient
      initialMembers={[awaiting as never]}
      total={1}
      page={1}
      pageSize={25}
      search=""
      status=""
      role={role}
      plans={[]}
      coaches={[]}
      gymName="Iron Gym"
      registrationFee={5000}
    />,
  );
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: /members.actions.menu/ }));
  await user.click(screen.getByRole("menuitem", { name: /members.actions.waiveFee/ }));
}

describe("MembersPageClient waive dialog (Story 23-6c)", () => {
  it("support: the waive dialog shows the code field", async () => {
    await openWaive("support");
    expect(screen.getByLabelText("supportStepUp.codeLabel")).toBeInTheDocument();
  });

  it("a staff role: no code field", async () => {
    await openWaive("owner");
    expect(screen.queryByLabelText("supportStepUp.codeLabel")).toBeNull();
  });
});
