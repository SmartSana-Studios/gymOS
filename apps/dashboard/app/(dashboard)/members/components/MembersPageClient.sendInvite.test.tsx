/**
 * Story 2.10 (Task 3, AC #1-#4): component-level test of the "Send Invite"
 * button's wiring in `MembersPageClient`. This app has no Playwright/browser
 * E2E setup and the feature's own Testing Standards note that verification
 * against the real Evolution API gateway was done manually -- this suite
 * covers the actual client-side workflow (button click -> toast -> fallback
 * modal) with React Testing Library instead, mocking the Server Action layer
 * and the heavier sibling modals (MemberModal/DeactivateMemberDialog/
 * CsvImportModal), which are each other stories' own concerns.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const sendMemberInvite = vi.fn();

beforeEach(() => {
  sendMemberInvite.mockReset();
});

vi.mock("../actions", () => ({
  sendMemberInvite: (...args: unknown[]) => sendMemberInvite(...args),
  exportMembersCsv: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/members",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) => {
      if (key === "members.invite.sentConfirmation") return `Invite sent to ${vars?.name} via WhatsApp`;
      if (key === "members.invite.sendFailedFallback") return "Automated send failed -- fallback shown";
      if (key === "members.invite.sending") return "Sending...";
      if (key === "members.actions.invite") return "Invite";
      return key;
    },
    i18n: { language: "en" },
  }),
}));

vi.mock("./MemberModal", () => ({ MemberModal: () => null }));
vi.mock("./DeactivateMemberDialog", () => ({ DeactivateMemberDialog: () => null }));
vi.mock("./CsvImportModal", () => ({ CsvImportModal: () => null }));
vi.mock("./InviteMemberModal", () => ({
  InviteMemberModal: ({ member }: { member: { name: string } }) => (
    <div data-testid="invite-fallback-modal">{member.name}</div>
  ),
}));

async function renderPage() {
  const { MembersPageClient } = await import("./MembersPageClient");
  const member = {
    id: "member-1",
    name: "Alice",
    phone: "+237680811041",
    email: null,
    dob: null,
    photoUrl: null,
    emergencyContact: null,
    planId: null,
    planName: "Monthly",
    planType: "recurring",
    status: "active" as const,
    expiryDate: null,
    joinDate: "2026-01-01",
    deactivatedAt: null,
  };
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
    />,
  );
  return { member };
}

describe("MembersPageClient - Send Invite (Story 2.10)", () => {
  it("AC #1/#2: a successful automated send shows a confirmation toast and never opens the fallback modal", async () => {
    sendMemberInvite.mockResolvedValue({ data: { sent: true }, error: null });
    const user = userEvent.setup();
    await renderPage();

    await user.click(screen.getByRole("button", { name: /invite/i }));

    await waitFor(() => expect(sendMemberInvite).toHaveBeenCalledWith("member-1"));
    const toast = await screen.findByRole("status");
    expect(within(toast).getByText("Invite sent to Alice via WhatsApp")).toBeInTheDocument();
    expect(screen.queryByTestId("invite-fallback-modal")).not.toBeInTheDocument();
  });

  it("AC #3: a failed automated send (sent:false) shows an inline error toast and opens the fallback modal", async () => {
    sendMemberInvite.mockResolvedValue({ data: { sent: false }, error: null });
    const user = userEvent.setup();
    await renderPage();

    await user.click(screen.getByRole("button", { name: /invite/i }));

    const toast = await screen.findByRole("status");
    expect(within(toast).getByText("Automated send failed -- fallback shown")).toBeInTheDocument();
    expect(await screen.findByTestId("invite-fallback-modal")).toBeInTheDocument();
  });

  it("code review fix: a genuine server error (e.g. member not found) shows the server's own message and does NOT open the fallback modal", async () => {
    sendMemberInvite.mockResolvedValue({
      data: null,
      error: { code: "not_found", message: "This member could not be found." },
    });
    const user = userEvent.setup();
    await renderPage();

    await user.click(screen.getByRole("button", { name: /invite/i }));

    const toast = await screen.findByRole("status");
    expect(within(toast).getByText("This member could not be found.")).toBeInTheDocument();
    expect(screen.queryByTestId("invite-fallback-modal")).not.toBeInTheDocument();
  });

  it("AC #4: the Send Invite button remains clickable after a send, allowing an immediate resend", async () => {
    sendMemberInvite.mockResolvedValue({ data: { sent: true }, error: null });
    const user = userEvent.setup();
    await renderPage();

    const button = screen.getByRole("button", { name: /invite/i });
    await user.click(button);
    await waitFor(() => expect(sendMemberInvite).toHaveBeenCalledTimes(1));

    expect(button).not.toBeDisabled();
    await user.click(button);
    await waitFor(() => expect(sendMemberInvite).toHaveBeenCalledTimes(2));
  });

  it("shows a distinct in-flight state on the button while the send is pending", async () => {
    let resolveSend!: (value: { data: { sent: boolean }; error: null }) => void;
    sendMemberInvite.mockReturnValue(
      new Promise((resolve) => {
        resolveSend = resolve;
      }),
    );
    const user = userEvent.setup();
    await renderPage();

    await user.click(screen.getByRole("button", { name: /invite/i }));

    expect(await screen.findByRole("button", { name: "Sending..." })).toBeDisabled();
    resolveSend({ data: { sent: true }, error: null });
    await waitFor(() => expect(screen.getByRole("button", { name: /invite/i })).not.toBeDisabled());
  });
});
