/**
 * Story 27.4 (UX AD-04): the member View modal shows the plan as the plan summary line, the read-only "Subscription started" date beside
 * Expiry Date (omitted for Pay-per-session), and a [Correct plan] button beside [Record session payment] that exists only when the page
 * passes the handler (Manager and above) and the member has a current subscription.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { realT } from "@/test-utils/realT";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: realT("en"), i18n: { language: "en" } }) }));
vi.mock("../actions", () => ({
  createMember: vi.fn(),
  editMember: vi.fn(),
  assignCoach: vi.fn(),
  getCoachAssignments: vi.fn(async () => ({ data: [], error: null })),
  getMemberLoyaltyAction: vi.fn(async () => ({ data: null, error: null })),
}));
vi.mock("@/app/(dashboard)/payments/actions", () => ({
  getMemberRegistrationFeeStateAction: vi.fn(async () => ({ data: { kind: "none" }, error: null })),
  listMemberGuestSessionsAction: vi.fn(async () => ({ data: [], error: null })),
}));
vi.mock("@/components/shared/RecordSessionPaymentDialog", () => ({ RecordSessionPaymentDialog: () => null }));

const MEMBER = {
  id: "m-1", name: "Ange T.", phone: "+237680811041", email: null, dob: null, photoUrl: null, emergencyContact: null,
  planId: "p-1", planName: "ANNUAL", planType: "monthly", status: "active", expiryDate: "2027-11-02", joinDate: "2026-01-01",
  deactivatedAt: null, registrationFeeSettledAt: "2026-01-01T00:00:00Z",
  subscriptionId: "s-1", subscriptionStartDate: "2026-11-02", planPrice: 250000, planDurationDays: 365, planBillingInterval: "annual",
};

async function renderView(member: unknown, onCorrectPlan?: () => void, role = "manager") {
  const { MemberModal } = await import("./MemberModal");
  render(
    <MemberModal open readOnly editingMember={member as never} plans={[]} coaches={[]} role={role} onCorrectPlan={onCorrectPlan as never} onClose={vi.fn()} onSaved={vi.fn()} />,
  );
}

describe("MemberModal view: plan summary, Subscription started, [Correct plan] (Story 27.4)", () => {
  it("the Plan field reads 'Annual (250,000 XAF · 365 days · Paid once)'", async () => {
    await renderView(MEMBER);
    expect(await screen.findByText("ANNUAL (250,000 XAF · 365 days · Paid once)")).toBeInTheDocument();
  });

  it("'Subscription started' sits beside Expiry Date", async () => {
    await renderView(MEMBER, undefined, "receptionist");
    expect(await screen.findByText("Subscription started")).toBeInTheDocument();
    expect(screen.getByText("Expiry Date")).toBeInTheDocument();
  });

  it("'Subscription started' is omitted for Pay-per-session", async () => {
    await renderView({ ...MEMBER, planType: "pay_per_session", planName: "DROP-IN", planPrice: 2000, planDurationDays: null, planBillingInterval: "monthly", expiryDate: null });
    await screen.findByText("DROP-IN (2,000 XAF / session)");
    expect(screen.queryByText("Subscription started")).not.toBeInTheDocument();
  });

  it("shows [Correct plan] when the page passes the handler, and calls it with the member", async () => {
    const onCorrectPlan = vi.fn();
    const user = userEvent.setup();
    await renderView(MEMBER, onCorrectPlan);
    await user.click(await screen.findByRole("button", { name: "Correct plan" }));
    expect(onCorrectPlan).toHaveBeenCalledTimes(1);
    expect(onCorrectPlan.mock.calls[0][0]).toBe(MEMBER);
  });

  it("is absent without the handler (Receptionist, Coach)", async () => {
    await renderView(MEMBER, undefined, "receptionist");
    await screen.findByText("Subscription started");
    expect(screen.queryByRole("button", { name: "Correct plan" })).not.toBeInTheDocument();
  });

  it("is absent for a deactivated member (27-4 review: the database refuses it too)", async () => {
    await renderView({ ...MEMBER, deactivatedAt: "2026-11-10T09:00:00Z" }, vi.fn());
    await screen.findByText("Subscription started");
    expect(screen.queryByRole("button", { name: "Correct plan" })).not.toBeInTheDocument();
  });

  it("is absent when the member has no current subscription", async () => {
    await renderView({ ...MEMBER, planId: null, planName: null, planType: null, status: "no_active_plan", expiryDate: null, subscriptionId: null, subscriptionStartDate: null }, vi.fn());
    await screen.findByText("Phone");
    expect(screen.queryByRole("button", { name: "Correct plan" })).not.toBeInTheDocument();
  });
});
