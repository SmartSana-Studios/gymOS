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
      if (key === "members.actions.menu") return `Actions for ${vars?.name}`;
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

// The dropdown's content isn't mounted until the row's trigger is opened
// (Radix renders `role="menuitem"`, not `role="button"`, for its items), so
// every interaction with "Invite" now goes through this helper instead of
// querying a button directly. The item's accessible name is "Invite" while
// idle and "Sending..." while in flight, so the regex matches both --
// otherwise a lookup mid-flight would fail to find the (still-present, just
// relabeled) item.
async function openInviteMenuItem(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /actions for/i }));
  return screen.findByRole("menuitem", { name: /invite|sending/i });
}

describe("MembersPageClient - Send Invite (Story 2.10)", () => {
  it("AC #1/#2: a successful automated send shows a confirmation toast and never opens the fallback modal", async () => {
    sendMemberInvite.mockResolvedValue({ data: { sent: true }, error: null });
    const user = userEvent.setup();
    await renderPage();

    const inviteItem = await openInviteMenuItem(user);
    await user.click(inviteItem);

    await waitFor(() => expect(sendMemberInvite).toHaveBeenCalledWith("member-1"));
    // { hidden: true } guards against the toast rendering while Radix's modal
    // DropdownMenu hasn't yet finished restoring aria-hidden on the rest of
    // the tree from the item click that just closed it.
    const toast = await screen.findByRole("status", { hidden: true });
    expect(within(toast).getByText("Invite sent to Alice via WhatsApp")).toBeInTheDocument();
    expect(screen.queryByTestId("invite-fallback-modal")).not.toBeInTheDocument();
  });

  it("AC #3: a failed automated send (sent:false) shows an inline error toast and opens the fallback modal", async () => {
    sendMemberInvite.mockResolvedValue({ data: { sent: false }, error: null });
    const user = userEvent.setup();
    await renderPage();

    const inviteItem = await openInviteMenuItem(user);
    await user.click(inviteItem);

    const toast = await screen.findByRole("status", { hidden: true });
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

    const inviteItem = await openInviteMenuItem(user);
    await user.click(inviteItem);

    const toast = await screen.findByRole("status", { hidden: true });
    expect(within(toast).getByText("This member could not be found.")).toBeInTheDocument();
    expect(screen.queryByTestId("invite-fallback-modal")).not.toBeInTheDocument();
  });

  it("Review finding (Story 2.10): an unexpected thrown exception falls back the same as a gateway-unreachable result", async () => {
    sendMemberInvite.mockRejectedValue(new Error("network exploded"));
    const user = userEvent.setup();
    await renderPage();

    const inviteItem = await openInviteMenuItem(user);
    await user.click(inviteItem);

    const toast = await screen.findByRole("status", { hidden: true });
    expect(within(toast).getByText("Automated send failed -- fallback shown")).toBeInTheDocument();
    expect(await screen.findByTestId("invite-fallback-modal")).toBeInTheDocument();
  });

  it("AC #4: the Invite item remains clickable after a send, allowing an immediate resend", async () => {
    sendMemberInvite.mockResolvedValue({ data: { sent: true }, error: null });
    const user = userEvent.setup();
    await renderPage();

    let inviteItem = await openInviteMenuItem(user);
    await user.click(inviteItem);
    await waitFor(() => expect(sendMemberInvite).toHaveBeenCalledTimes(1));

    // The menu closed immediately on selection (it no longer stays open
    // through the async call) -- reopen it to observe that the item is not
    // left disabled once the send has resolved.
    inviteItem = await openInviteMenuItem(user);
    expect(inviteItem).not.toHaveAttribute("aria-disabled", "true");
    await user.click(inviteItem);
    await waitFor(() => expect(sendMemberInvite).toHaveBeenCalledTimes(2));
  });

  it("shows a distinct in-flight state on the menu item while the send is pending, visible on reopening the menu", async () => {
    let resolveSend!: (value: { data: { sent: boolean }; error: null }) => void;
    sendMemberInvite.mockReturnValue(
      new Promise((resolve) => {
        resolveSend = resolve;
      }),
    );
    const user = userEvent.setup();
    await renderPage();

    const inviteItem = await openInviteMenuItem(user);
    await user.click(inviteItem);
    await waitFor(() => expect(sendMemberInvite).toHaveBeenCalledTimes(1));

    // The menu closes immediately on selection, so the in-flight/disabled
    // state is only observable by reopening the menu while the send is
    // still pending -- not by the menu staying open through the async call.
    const pendingItem = await openInviteMenuItem(user);
    expect(pendingItem).toHaveTextContent("Sending...");
    expect(pendingItem).toHaveAttribute("aria-disabled", "true");

    resolveSend({ data: { sent: true }, error: null });
    await screen.findByRole("status", { hidden: true });

    await user.keyboard("{Escape}");
    const resolvedItem = await openInviteMenuItem(user);
    expect(resolvedItem).not.toHaveAttribute("aria-disabled", "true");
    expect(resolvedItem).toHaveTextContent("Invite");
  });
});
