/**
 * Story 18.5: pins the registrationFee prop chain MembersPageClient -> MemberModal
 * with the REAL MemberModal (every other test mocks it). A fee gym must get the
 * two-step form without the plan field; fee 0 keeps the plan field.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../actions", () => ({
  sendMemberInvite: vi.fn(),
  exportMembersCsv: vi.fn(),
  createMember: vi.fn(),
  editMember: vi.fn(),
  assignCoach: vi.fn(),
  getCoachAssignments: vi.fn(async () => ({ data: null, error: null })),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/members",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));

vi.mock("@/components/ui/phone-input", () => ({
  PhoneInput: ({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) => (
    <input id={id} value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));

vi.mock("./DeactivateMemberDialog", () => ({ DeactivateMemberDialog: () => null }));
vi.mock("./CsvImportModal", () => ({ CsvImportModal: () => null }));
vi.mock("./InviteMemberModal", () => ({ InviteMemberModal: () => null }));

const member = {
  id: "m1",
  name: "Alice",
  phone: "+237680811041",
  email: null,
  dob: null,
  photoUrl: null,
  emergencyContact: null,
  planId: "plan-1",
  planName: "Monthly",
  planType: "recurring",
  status: "active" as const,
  expiryDate: null,
  joinDate: "2026-01-01",
  deactivatedAt: null,
  registrationFeeSettledAt: "2026-01-01T00:00:00Z",
};

async function openStepTwo(registrationFee: number) {
  const { MembersPageClient } = await import("./MembersPageClient");
  const user = userEvent.setup();
  render(
    <MembersPageClient
      initialMembers={[member]}
      total={1}
      page={1}
      pageSize={25}
      search=""
      status=""
      role="owner"
      plans={[]}
      coaches={[]}
      gymName="Iron Gym"
      registrationFee={registrationFee}
    />,
  );
  await user.click(screen.getByRole("button", { name: "members.addMember" }));
  await user.type(document.getElementById("memberName") as HTMLInputElement, "Bob Ngono");
  await user.click(screen.getByRole("button", { name: "common.next" }));
}

describe("MembersPageClient -> MemberModal registrationFee chain (Story 18.5)", () => {
  it("fee above 0: the create modal shows the fee notice and no plan field", async () => {
    await openStepTwo(5000);

    expect(await screen.findByText("members.modal.registrationFeeNotice")).toBeInTheDocument();
    expect(document.getElementById("memberPlan")).toBeNull();
  });

  it("fee 0: the create modal has the plan field and no fee notice", async () => {
    await openStepTwo(0);

    expect(await screen.findByLabelText("members.modal.plan")).toBeInTheDocument();
    expect(document.getElementById("memberPlan")).toBeInTheDocument();
    expect(screen.queryByText("members.modal.registrationFeeNotice")).toBeNull();
  });
});
