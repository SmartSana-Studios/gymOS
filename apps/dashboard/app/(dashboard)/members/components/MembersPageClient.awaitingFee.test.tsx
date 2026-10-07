/**
 * Story 18.5: the members list shows and filters the awaiting-registration-fee
 * state, and the WhatsApp invite is disabled (with an explanation) for an
 * awaiting member. A settled member with no plan keeps the "no plan" badge.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const sendMemberInvite = vi.fn();
const push = vi.fn();

beforeEach(() => {
  sendMemberInvite.mockReset();
  push.mockReset();
});

vi.mock("../actions", () => ({
  sendMemberInvite: (...args: unknown[]) => sendMemberInvite(...args),
  exportMembersCsv: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
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

const base = {
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
};

const awaiting = { ...base, id: "m-awaiting", name: "Awaiting Ann", registrationFeeSettledAt: null };
const settledNoPlan = {
  ...base,
  id: "m-settled",
  name: "Settled Sam",
  phone: "+237680811042",
  registrationFeeSettledAt: "2026-01-02T00:00:00Z",
};

async function renderPage(members = [awaiting, settledNoPlan]) {
  const { MembersPageClient } = await import("./MembersPageClient");
  render(
    <MembersPageClient
      initialMembers={members}
      total={members.length}
      page={1}
      pageSize={25}
      search=""
      status=""
      role="owner"
      plans={[]}
      coaches={[]}
      gymName="Iron Gym"
      registrationFee={5000}
    />,
  );
}

describe("MembersPageClient awaiting registration fee (Story 18.5)", () => {
  it("badges an awaiting member and keeps 'no plan' for a settled member without a plan", async () => {
    await renderPage();

    const rows = screen.getAllByRole("row");
    const awaitingRow = rows.find((r) => r.textContent?.includes("Awaiting Ann"));
    const settledRow = rows.find((r) => r.textContent?.includes("Settled Sam"));
    expect(awaitingRow).toHaveTextContent("members.status.awaitingRegistrationFee");
    expect(awaitingRow).not.toHaveTextContent("members.status.noActivePlan");
    expect(settledRow).toHaveTextContent("members.status.noActivePlan");
    expect(settledRow).not.toHaveTextContent("members.status.awaitingRegistrationFee");
  });

  it("offers the awaiting filter and pushes it into the URL", async () => {
    const user = userEvent.setup();
    await renderPage();

    const select = screen.getByLabelText("members.filters.status");
    expect(screen.getByRole("option", { name: "members.status.awaitingRegistrationFee" })).toBeInTheDocument();
    await user.selectOptions(select, "awaiting_registration_fee");

    expect(push).toHaveBeenCalledWith(expect.stringContaining("status=awaiting_registration_fee"));
  });

  it("disables the invite for an awaiting member and explains why; sends nothing", async () => {
    const user = userEvent.setup();
    await renderPage([awaiting]);

    await user.click(screen.getByRole("button", { name: /members.actions.menu/ }));
    const invite = await screen.findByRole("menuitem", { name: /members.actions.invite/ });

    expect(invite).toHaveAttribute("aria-disabled", "true");
    expect(invite).toHaveTextContent("members.invite.awaitingRegistrationFee");
    await user.click(invite);
    expect(sendMemberInvite).not.toHaveBeenCalled();
  });

  it("keeps the invite enabled for a settled member", async () => {
    const user = userEvent.setup();
    await renderPage([settledNoPlan]);

    await user.click(screen.getByRole("button", { name: /members.actions.menu/ }));
    const invite = await screen.findByRole("menuitem", { name: /members.actions.invite/ });

    expect(invite).not.toHaveAttribute("aria-disabled", "true");
    expect(invite).not.toHaveTextContent("members.invite.awaitingRegistrationFee");
  });

  it("shows the rows-per-page selector and keeps size when filtering", async () => {
    const user = userEvent.setup();
    await renderPage();

    const sizeSelect = screen.getAllByLabelText("pagination.rowsPerPage")[0];
    expect(sizeSelect).toHaveValue("25");
    await user.selectOptions(sizeSelect, "10");
    expect(push).toHaveBeenCalledWith(expect.stringMatching(/size=10/));
    expect(push).toHaveBeenCalledWith(expect.stringContaining("page=1"));
  });
});
