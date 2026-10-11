/**
 * Story 19.9b: MembersPageClient hands role and chargeGuestsPerSession to
 * MemberModal.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const memberModalProps = vi.fn();

vi.mock("../actions", () => ({ sendMemberInvite: vi.fn(), exportMembersCsv: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/members",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));
vi.mock("./MemberModal", () => ({
  MemberModal: (props: Record<string, unknown>) => {
    memberModalProps(props);
    return null;
  },
}));
vi.mock("./DeactivateMemberDialog", () => ({ DeactivateMemberDialog: () => null }));
vi.mock("./CsvImportModal", () => ({ CsvImportModal: () => null }));
vi.mock("./InviteMemberModal", () => ({ InviteMemberModal: () => null }));
vi.mock("./CollectRegistrationFeeDialog", () => ({ CollectRegistrationFeeDialog: () => null }));
vi.mock("./WaiveRegistrationFeeDialog", () => ({ WaiveRegistrationFeeDialog: () => null }));
vi.mock("./VoidRegistrationFeeDialog", () => ({ VoidRegistrationFeeDialog: () => null }));
vi.mock("./AssignInitialPlanDialog", () => ({ AssignInitialPlanDialog: () => null }));

const member = {
  id: "m1",
  name: "Alice",
  phone: "+237680811041",
  email: null,
  dob: null,
  photoUrl: null,
  emergencyContact: null,
  planId: null,
  planName: null,
  planType: null,
  status: "no_active_plan" as const,
  expiryDate: null,
  joinDate: "2026-01-01",
  deactivatedAt: null,
  registrationFeeSettledAt: "2026-01-02T00:00:00Z",
};

describe("MembersPageClient -> MemberModal session props (Story 19.9b)", () => {
  it("passes role and chargeGuestsPerSession", async () => {
    const { MembersPageClient } = await import("./MembersPageClient");
    render(
      <MembersPageClient
        initialMembers={[member as never]}
        total={1}
        page={1}
        pageSize={25}
        search=""
        status=""
        role="receptionist"
        plans={[]}
        coaches={[]}
        gymName="Iron Gym"
        chargeGuestsPerSession
      />,
    );
    await userEvent.setup().click(screen.getByText("Alice"));

    expect(memberModalProps).toHaveBeenCalledWith(
      expect.objectContaining({ role: "receptionist", chargeGuestsPerSession: true }),
    );
  });
});
