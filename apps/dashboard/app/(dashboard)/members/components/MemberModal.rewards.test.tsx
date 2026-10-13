/* eslint-disable i18next/no-literal-string -- test doubles render fixed marker text; no user-facing copy */
/**
 * Story 20.5: the member modal's Rewards section -- visibility matrix, both
 * counters, free sessions, and no edit control for any role.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const getMemberLoyaltyAction = vi.fn();

vi.mock("../actions", () => ({
  createMember: vi.fn(),
  editMember: vi.fn(),
  assignCoach: vi.fn(),
  getCoachAssignments: vi.fn(async () => ({ data: null, error: null })),
  getMemberLoyaltyAction: (...args: unknown[]) => getMemberLoyaltyAction(...args),
}));
vi.mock("@/app/(dashboard)/payments/actions", () => ({
  getMemberRegistrationFeeStateAction: vi.fn(async () => ({ data: { kind: "none" }, error: null })),
  listMemberGuestSessionsAction: vi.fn(async () => ({ data: [], error: null })),
}));
vi.mock("@/components/shared/RecordSessionPaymentDialog", () => ({
  RecordSessionPaymentDialog: ({ onRecorded }: { onRecorded: () => void }) => (
    <button type="button" onClick={onRecorded}>
      finish-record
    </button>
  ),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      vars ? `${key}|${Object.values(vars).join("|")}` : key,
    i18n: { language: "en" },
  }),
}));

const member = {
  id: "m1",
  name: "Alice",
  phone: "+237680811041",
  email: null,
  dob: null,
  photoUrl: null,
  emergencyContact: null,
  planId: "plan-2",
  planName: "Monthly",
  planType: "monthly",
  status: "active" as const,
  expiryDate: "2026-12-01",
  joinDate: "2026-01-01",
  deactivatedAt: null,
  registrationFeeSettledAt: "2026-01-02T00:00:00Z",
};

const LOYALTY = {
  enabled: true,
  guestStamps: 3,
  subscriberStamps: 1,
  guestThreshold: 5,
  renewalThreshold: 3,
  freeSessions: [{ id: "f1", usableUntil: "2026-12-01T00:00:00Z" }],
};

const PLANS = [
  { id: "plan-2", name: "Monthly", planType: "monthly", price: 15000, currency: "XAF" },
  { id: "plan-1", name: "Drop-in", planType: "pay_per_session", price: 2000, currency: "XAF" },
] as never;

function modal(editing: Record<string, unknown>, MemberModal: typeof import("./MemberModal").MemberModal, role: string) {
  return (
    <MemberModal
      open
      readOnly
      editingMember={{ ...member, ...editing } as never}
      plans={PLANS}
      coaches={[]}
      role={role}
      chargeGuestsPerSession
      onClose={vi.fn()}
      onSaved={vi.fn()}
    />
  );
}

async function renderView(role = "receptionist", editing: Record<string, unknown> = {}) {
  const { MemberModal } = await import("./MemberModal");
  return { ...render(modal(editing, MemberModal, role)), MemberModal };
}

describe("MemberModal rewards (Story 20.5)", () => {
  beforeEach(() => {
    getMemberLoyaltyAction.mockReset().mockResolvedValue({ data: LOYALTY, error: null });
  });

  it.each(["receptionist", "manager", "supervisor", "owner"])(
    "shows both counters, free sessions and the rules line for %s",
    async (role) => {
      await renderView(role);
      expect(await screen.findByText("members.modal.rewards.title")).toBeInTheDocument();
      expect(screen.getByText("members.modal.rewards.guestProgress")).toBeInTheDocument();
      expect(screen.getByText("3 / 5")).toBeInTheDocument();
      expect(screen.getByText("members.modal.rewards.subscriberProgress")).toBeInTheDocument();
      expect(screen.getByText("1 / 3")).toBeInTheDocument();
      expect(screen.getByText("members.modal.rewards.freeSession")).toBeInTheDocument();
      expect(screen.getByText(/members.modal.rewards.lapsesOn/)).toBeInTheDocument();
      expect(screen.getByText("members.modal.rewards.rulesOnly")).toBeInTheDocument();
    },
  );

  it("has no input, button or link inside the section", async () => {
    await renderView("owner");
    const section = (await screen.findByText("members.modal.rewards.title")).closest("section")!;
    expect(section.querySelectorAll("input, button, a, select, textarea")).toHaveLength(0);
  });

  it("is not read and not shown for a coach", async () => {
    await renderView("coach");
    await new Promise((r) => setTimeout(r, 20));
    expect(getMemberLoyaltyAction).not.toHaveBeenCalled();
    expect(screen.queryByText("members.modal.rewards.title")).not.toBeInTheDocument();
  });

  it("is absent when the program is off and nothing is held", async () => {
    getMemberLoyaltyAction.mockResolvedValue({ data: { ...LOYALTY, enabled: false, freeSessions: [] }, error: null });
    await renderView();
    await waitFor(() => expect(getMemberLoyaltyAction).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText("members.modal.rewards.title")).not.toBeInTheDocument();
  });

  it("shows free sessions only, no counters, when off but a free session is held", async () => {
    getMemberLoyaltyAction.mockResolvedValue({ data: { ...LOYALTY, enabled: false }, error: null });
    await renderView();
    expect(await screen.findByText("members.modal.rewards.freeSession")).toBeInTheDocument();
    expect(screen.queryByText("members.modal.rewards.guestProgress")).not.toBeInTheDocument();
    expect(screen.queryByText("members.modal.rewards.subscriberProgress")).not.toBeInTheDocument();
    expect(screen.queryByText("3 / 5")).not.toBeInTheDocument();
  });

  it("leaves the section out for a null result (suspended gym) or a failed read", async () => {
    getMemberLoyaltyAction.mockResolvedValue({ data: null, error: null });
    await renderView();
    await waitFor(() => expect(getMemberLoyaltyAction).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText("members.modal.rewards.title")).not.toBeInTheDocument();
  });

  it("leaves the section out when the action throws", async () => {
    getMemberLoyaltyAction.mockRejectedValue(new Error("boom"));
    await renderView();
    await waitFor(() => expect(getMemberLoyaltyAction).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText("members.modal.rewards.title")).not.toBeInTheDocument();
  });

  it("leaves the section out for an error result", async () => {
    getMemberLoyaltyAction.mockResolvedValue({ data: null, error: { message: "denied" } });
    await renderView();
    await waitFor(() => expect(getMemberLoyaltyAction).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText("members.modal.rewards.title")).not.toBeInTheDocument();
  });

  it("re-reads the rewards after a session payment is recorded", async () => {
    await renderView("receptionist", { planId: "plan-1", planName: "Drop-in", planType: "pay_per_session" });
    expect(await screen.findByText("3 / 5")).toBeInTheDocument();
    expect(getMemberLoyaltyAction).toHaveBeenCalledTimes(1);

    getMemberLoyaltyAction.mockResolvedValue({ data: { ...LOYALTY, guestStamps: 4 }, error: null });
    fireEvent.click(screen.getByRole("button", { name: "members.modal.recordSessionPayment" }));
    fireEvent.click(await screen.findByRole("button", { name: "finish-record" }));

    expect(await screen.findByText("4 / 5")).toBeInTheDocument();
    expect(getMemberLoyaltyAction).toHaveBeenCalledTimes(2);
  });

  it("never shows a previous member's rewards after the modal switches member", async () => {
    let resolveFirst: (value: unknown) => void = () => {};
    getMemberLoyaltyAction
      .mockReset()
      .mockReturnValueOnce(new Promise((resolve) => (resolveFirst = resolve)))
      .mockResolvedValueOnce({ data: { ...LOYALTY, guestStamps: 1 }, error: null });
    const { rerender, MemberModal } = await renderView();
    rerender(modal({ id: "m2", name: "Bob" }, MemberModal, "receptionist"));

    expect(await screen.findByText("1 / 5")).toBeInTheDocument();
    resolveFirst({ data: { ...LOYALTY, guestStamps: 4 }, error: null });
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText("4 / 5")).not.toBeInTheDocument();
    expect(screen.getByText("1 / 5")).toBeInTheDocument();
  });
});
