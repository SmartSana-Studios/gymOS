/**
 * Story 18.6: the read-only member detail's registration fee line. Awaiting,
 * "Paid XAF n on date", "Waived by name" (name and reason only when the action
 * returns them), and nothing for a settled member with neither or a fee-0 gym.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const getMemberRegistrationFeeStateAction = vi.fn();

vi.mock("../actions", () => ({
  createMember: vi.fn(),
  editMember: vi.fn(),
  assignCoach: vi.fn(),
  getCoachAssignments: vi.fn(async () => ({ data: null, error: null })),
}));

vi.mock("@/app/(dashboard)/payments/actions", () => ({
  getMemberRegistrationFeeStateAction: (...args: unknown[]) => getMemberRegistrationFeeStateAction(...args),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      vars ? `${key}|${Object.values(vars).join("|")}` : key,
    i18n: { language: "en" },
  }),
}));

const baseMember = {
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

async function renderView(member = baseMember, registrationFee = 5000) {
  const { MemberModal } = await import("./MemberModal");
  render(
    <MemberModal
      open
      readOnly
      editingMember={member as never}
      plans={[]}
      coaches={[]}
      registrationFee={registrationFee}
      onClose={vi.fn()}
      onSaved={vi.fn()}
    />,
  );
}

describe("MemberModal registration fee line (Story 18.6)", () => {
  beforeEach(() => {
    getMemberRegistrationFeeStateAction.mockReset();
  });

  it("shows Awaiting for an awaiting member", async () => {
    getMemberRegistrationFeeStateAction.mockResolvedValue({ data: { kind: "awaiting" }, error: null });
    await renderView({ ...baseMember, registrationFeeSettledAt: null } as never);

    expect(await screen.findByText("members.feeState.awaiting")).toBeInTheDocument();
    expect(screen.getByText("members.modal.view.registrationFee")).toBeInTheDocument();
  });

  it("shows the amount and date for a paid fee", async () => {
    getMemberRegistrationFeeStateAction.mockResolvedValue({
      data: { kind: "paid", paymentId: "p1", amount: 5000, currency: "XAF", method: "cash", paidAt: "2026-10-01T10:00:00Z" },
      error: null,
    });
    await renderView();

    expect(await screen.findByText(/^members\.feeState\.paid\|5,000\|/)).toBeInTheDocument();
  });

  it("shows who waived it and why when the action returns them", async () => {
    getMemberRegistrationFeeStateAction.mockResolvedValue({
      data: { kind: "waived", waivedByName: "Marie Owner", reason: "Friend of the owner" },
      error: null,
    });
    await renderView();

    expect(await screen.findByText("members.feeState.waivedBy|Marie Owner")).toBeInTheDocument();
    expect(screen.getByText("members.feeState.waivedReason|Friend of the owner")).toBeInTheDocument();
  });

  it("shows only 'Waived' when the name and reason are withheld (receptionist)", async () => {
    getMemberRegistrationFeeStateAction.mockResolvedValue({
      data: { kind: "waived", waivedByName: null, reason: null },
      error: null,
    });
    await renderView();

    expect(await screen.findByText("members.feeState.waived")).toBeInTheDocument();
    expect(screen.queryByText(/members\.feeState\.waivedBy/)).not.toBeInTheDocument();
    expect(screen.queryByText(/members\.feeState\.waivedReason/)).not.toBeInTheDocument();
  });

  it("shows nothing for a settled member with neither a payment nor a waiver", async () => {
    getMemberRegistrationFeeStateAction.mockResolvedValue({ data: { kind: "none" }, error: null });
    await renderView();

    await waitFor(() => expect(getMemberRegistrationFeeStateAction).toHaveBeenCalledWith("m1"));
    expect(screen.queryByText("members.modal.view.registrationFee")).not.toBeInTheDocument();
  });

  it("fetches nothing and shows nothing in a fee-0 gym for a settled member", async () => {
    await renderView(baseMember, 0);

    expect(getMemberRegistrationFeeStateAction).not.toHaveBeenCalled();
    expect(screen.queryByText("members.modal.view.registrationFee")).not.toBeInTheDocument();
  });

  it("an awaiting member in a gym whose fee is now 0 still fetches and shows the awaiting line", async () => {
    getMemberRegistrationFeeStateAction.mockResolvedValue({ data: { kind: "awaiting" }, error: null });
    await renderView({ ...baseMember, registrationFeeSettledAt: null } as never, 0);

    expect(await screen.findByText("members.feeState.awaiting")).toBeInTheDocument();
    expect(getMemberRegistrationFeeStateAction).toHaveBeenCalledWith("m1");
  });

  it("clears the previous line on reopen and shows nothing when the new fetch fails", async () => {
    getMemberRegistrationFeeStateAction.mockResolvedValueOnce({ data: { kind: "awaiting" }, error: null });
    const { MemberModal } = await import("./MemberModal");
    const awaitingMember = { ...baseMember, registrationFeeSettledAt: null } as never;
    const { rerender } = render(
      <MemberModal open readOnly editingMember={awaitingMember} plans={[]} coaches={[]} registrationFee={5000} onClose={vi.fn()} onSaved={vi.fn()} />,
    );
    expect(await screen.findByText("members.feeState.awaiting")).toBeInTheDocument();

    getMemberRegistrationFeeStateAction.mockRejectedValueOnce(new Error("offline"));
    const settledMember = { ...baseMember } as never;
    rerender(
      <MemberModal open readOnly editingMember={settledMember} plans={[]} coaches={[]} registrationFee={5000} onClose={vi.fn()} onSaved={vi.fn()} />,
    );

    await waitFor(() => expect(getMemberRegistrationFeeStateAction).toHaveBeenCalledTimes(2));
    expect(screen.queryByText("members.feeState.awaiting")).not.toBeInTheDocument();
    expect(screen.queryByText("members.modal.view.registrationFee")).not.toBeInTheDocument();
  });
});
