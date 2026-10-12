/**
 * Story 19.10: `?memberId=` opens the AD-04 modal on load (read-only, like
 * View), and closing it drops the param so a refresh does not reopen it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

const memberModalProps = vi.fn();
const replace = vi.fn();
let search = "memberId=m1&status=active";

vi.mock("../actions", () => ({ sendMemberInvite: vi.fn(), exportMembersCsv: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace }),
  usePathname: () => "/members",
  useSearchParams: () => new URLSearchParams(search),
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

async function renderPage(deepLinkMember: typeof member | null) {
  const { MembersPageClient } = await import("./MembersPageClient");
  render(
    <MembersPageClient
      initialMembers={[]}
      total={0}
      page={1}
      pageSize={25}
      search=""
      status=""
      role="owner"
      plans={[]}
      coaches={[]}
      gymName="Iron Gym"
      deepLinkMember={deepLinkMember as never}
    />,
  );
}

beforeEach(() => {
  memberModalProps.mockClear();
  replace.mockClear();
  search = "memberId=m1&status=active";
});

describe("MembersPageClient deep link (Story 19.10)", () => {
  it("opens the modal read-only for the deep-linked member on load", async () => {
    await renderPage(member);
    expect(memberModalProps).toHaveBeenCalledWith(
      expect.objectContaining({ open: true, readOnly: true, editingMember: member }),
    );
  });

  it("opens no modal without a deep link", async () => {
    await renderPage(null);
    expect(memberModalProps).not.toHaveBeenCalled();
  });

  it("drops memberId from the URL on close, keeping the other params", async () => {
    await renderPage(member);
    const props = memberModalProps.mock.calls[0][0] as { onClose: () => void };
    props.onClose();
    expect(replace).toHaveBeenCalledWith("/members?status=active");
  });
});
