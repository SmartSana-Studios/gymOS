/**
 * Story 27.4, UX AD-31: the Correct plan modal, every state of the I/O matrix against the real EN strings.
 *
 * Opening check (skeleton and "Checking payments…", then a block or the form), F1 to F5 blocked states with [Open payments], F6, F7 to F12,
 * the form rules (the select leaves out the current plan, 5 to 300 character reason, counter, rule line, the two notes), the support code,
 * success, and that a server refusal received on submit renders the matching F state.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { realT } from "@/test-utils/realT";

const goToLoginExpired = vi.fn();
const getCorrectPlanEligibilityAction = vi.fn();
const correctPlanAction = vi.fn();
const refresh = vi.fn();

vi.mock("@/components/support-code-field", async (importActual) => ({
  ...(await importActual<typeof import("@/components/support-code-field")>()),
  goToLoginExpired: () => goToLoginExpired(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: realT("en"), i18n: { language: "en" } }) }));
vi.mock("../actions", () => ({
  getCorrectPlanEligibilityAction: (...args: unknown[]) => getCorrectPlanEligibilityAction(...args),
  correctPlanAction: (...args: unknown[]) => correctPlanAction(...args),
}));

import { CorrectPlanModal } from "./CorrectPlanModal";

const MEMBER_FIXTURE = { id: "11111111-1111-4111-8111-111111111111", name: "Ange T." };
const MEMBER = MEMBER_FIXTURE as never;
const SUB_ID = "22222222-2222-4222-8222-222222222222";
const PLANS = [
  { id: "p-annual", name: "ANNUAL", planType: "monthly", price: 250000, durationDays: 365, billingInterval: "annual" },
  { id: "p-monthly", name: "MONTHLY", planType: "monthly", price: 25000, durationDays: 30, billingInterval: "monthly" },
  { id: "p-dropin", name: "DROP-IN", planType: "pay_per_session", price: 2000, durationDays: null, billingInterval: "monthly" },
] as never;

function eligibility(block: unknown = null) {
  return {
    data: {
      subscription: {
        subscriptionId: SUB_ID,
        planId: "p-annual",
        planName: "ANNUAL",
        planType: "monthly",
        billingInterval: "annual",
        price: 250000,
        durationDays: 365,
        startDate: "2026-11-02",
        expiryDate: "2027-11-02",
        status: "active",
      },
      block,
    },
    error: null,
  };
}

const standing = (state: string, extra: Record<string, unknown> = {}) => ({
  state,
  amount: 250000,
  method: "cash",
  createdAt: "2026-11-10T09:00:00Z",
  on: "2026-11-10",
  refundedAmount: 0,
  more: 0,
  ...extra,
});

function renderModal(props: { isSupport?: boolean; plans?: never } = {}) {
  const onClose = vi.fn();
  const onCorrected = vi.fn();
  render(<CorrectPlanModal member={MEMBER} plans={props.plans ?? PLANS} isSupport={props.isSupport} onClose={onClose} onCorrected={onCorrected} />);
  return { onClose, onCorrected };
}

async function fillAndSubmit(user: ReturnType<typeof userEvent.setup>, planId = "p-monthly", reason = "Wrong plan chosen at sign-up") {
  await screen.findByLabelText(/New plan/);
  await user.selectOptions(screen.getByLabelText(/New plan/), planId);
  await user.type(screen.getByLabelText(/Reason/), reason);
  await user.click(screen.getByRole("button", { name: "Correct plan" }));
}

describe("CorrectPlanModal (UX AD-31)", () => {
  beforeEach(() => {
    getCorrectPlanEligibilityAction.mockReset();
    correctPlanAction.mockReset();
    goToLoginExpired.mockReset();
    refresh.mockReset();
  });

  it("shows a skeleton and 'Checking payments…' while the opening check runs, with no form", async () => {
    getCorrectPlanEligibilityAction.mockReturnValue(new Promise(() => {}));
    renderModal();
    expect(screen.getByText("Checking payments…")).toBeInTheDocument();
    expect(screen.queryByLabelText(/Reason/)).not.toBeInTheDocument();
  });

  it("shows the current plan, the select without the current plan, the rule line, the two notes and the counter", async () => {
    getCorrectPlanEligibilityAction.mockResolvedValue(eligibility());
    renderModal();
    expect(await screen.findByText("ANNUAL (250,000 XAF · 365 days · Paid once)")).toBeInTheDocument();
    expect(screen.getByText(/Started 02 Nov 2026 · Expires 02 Nov 2027/)).toBeInTheDocument();
    const options = screen.getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(["Choose a plan", "MONTHLY · 25,000 XAF · 30 days", "DROP-IN · 2,000 XAF / session"]);
    expect(screen.getByText("The new expiry is counted from the start date (02 Nov 2026), not from today.")).toBeInTheDocument();
    expect(screen.getByText(/Ange T\.'s app shows the new plan the next time it opens\./)).toBeInTheDocument();
    expect(screen.getByText(/The registration fee is not affected\./)).toBeInTheDocument();
    expect(screen.getByText("0 / 300")).toBeInTheDocument();
    // The select shows no preview of the new expiry.
    expect(screen.queryByText(/new expiry will be/i)).not.toBeInTheDocument();
  });

  it("keeps [Correct plan] disabled until a plan and a reason of at least 5 characters are present", async () => {
    getCorrectPlanEligibilityAction.mockResolvedValue(eligibility());
    const user = userEvent.setup();
    renderModal();
    const submit = await screen.findByRole("button", { name: "Correct plan" });
    expect(submit).toBeDisabled();
    await user.selectOptions(screen.getByLabelText(/New plan/), "p-monthly");
    expect(submit).toBeDisabled();
    await user.type(screen.getByLabelText(/Reason/), "abcd");
    expect(submit).toBeDisabled();
    await user.type(screen.getByLabelText(/Reason/), "e");
    expect(submit).toBeEnabled();
    expect(screen.getByText("5 / 300")).toBeInTheDocument();
    await user.clear(screen.getByLabelText(/Reason/));
    await user.type(screen.getByLabelText(/Reason/), "      ");
    expect(submit).toBeDisabled();
  });

  it("says there is no other plan, with a link to Plans and no fields", async () => {
    getCorrectPlanEligibilityAction.mockResolvedValue(eligibility());
    renderModal({ plans: [PLANS[0]] as never });
    expect(await screen.findByText("There is no other plan to choose. Add a plan in Plans first.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Plans" })).toHaveAttribute("href", "/plans");
    expect(screen.queryByLabelText(/Reason/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Correct plan" })).not.toBeInTheDocument();
  });

  describe("a payment stands at open (F1 to F5)", () => {
    const cases: [string, Record<string, unknown>, string][] = [
      ["F1 verified", standing("verified"), "Can't correct the plan yet. The payment of 250,000 XAF on 10 Nov (Cash) is still recorded. Refund it fully first, then correct the plan."],
      ["F2 pending", standing("pending"), "Can't correct the plan yet. The payment of 250,000 XAF on 10 Nov (Cash) is awaiting verification. Refund it fully first, or wait until it settles, then correct the plan."],
      ["F3 in flight", standing("in_flight", { method: "mobile_money" }), "Can't correct the plan yet. The mobile money payment of 250,000 XAF started on 10 Nov is still in progress. Wait for it to settle. If it goes through, refund it fully, then correct the plan."],
      ["F4 partly refunded", standing("partly_refunded", { refundedAmount: 100000 }), "Can't correct the plan yet. The payment of 250,000 XAF on 10 Nov (Cash) is only partly refunded (100,000 XAF of 250,000 XAF). Refund the rest first, then correct the plan."],
    ];
    for (const [label, block, text] of cases) {
      it(`${label}: the block replaces the form, neutral, role=alert, with [Open payments] and [Close]`, async () => {
        getCorrectPlanEligibilityAction.mockResolvedValue(eligibility(block));
        renderModal();
        const alert = await screen.findByRole("alert");
        expect(alert).toHaveTextContent(text);
        expect(alert.className).not.toMatch(/red/);
        expect(screen.getByRole("link", { name: "Open payments" })).toHaveAttribute("href", `/payments?memberId=${MEMBER_FIXTURE.id}&purpose=subscription`);
        expect(screen.getAllByRole("button", { name: "Close" }).length).toBeGreaterThanOrEqual(1);
        expect(screen.queryByLabelText(/Reason/)).not.toBeInTheDocument();
      });
    }

    it("the opening check has no gym-local date: the payment's own timestamp is shown as '10 Nov'", async () => {
      getCorrectPlanEligibilityAction.mockResolvedValue(eligibility(standing("verified", { on: null, createdAt: "2026-11-10T09:00:00Z" })));
      renderModal();
      expect(await screen.findByRole("alert")).toHaveTextContent("The payment of 250,000 XAF on 10 Nov (Cash) is still recorded.");
    });

    it("F5: names the most recent payment and adds the count of the others", async () => {
      getCorrectPlanEligibilityAction.mockResolvedValue(eligibility(standing("verified", { more: 2 })));
      renderModal();
      expect(await screen.findByText("+ 2 more payments on this plan are still recorded.")).toBeInTheDocument();
    });

    it("F5: one more payment is singular", async () => {
      getCorrectPlanEligibilityAction.mockResolvedValue(eligibility(standing("verified", { more: 1 })));
      renderModal();
      expect(await screen.findByText("+ 1 more payment on this plan is still recorded.")).toBeInTheDocument();
    });
  });

  it("F8: no current subscription shows [Close] only", async () => {
    getCorrectPlanEligibilityAction.mockResolvedValue({ data: null, error: null });
    renderModal();
    expect(await screen.findByRole("alert")).toHaveTextContent("Ange T. has no current plan to correct.");
    expect(screen.queryByRole("link", { name: "Open payments" })).not.toBeInTheDocument();
  });

  it("a load failure shows the message and [Retry], no form; Retry asks again", async () => {
    getCorrectPlanEligibilityAction.mockResolvedValueOnce({ data: null, error: { code: "unknown", message: "x" } });
    getCorrectPlanEligibilityAction.mockResolvedValueOnce(eligibility());
    const user = userEvent.setup();
    renderModal();
    expect(await screen.findByText("Couldn't check this member's payments. Try again.")).toBeInTheDocument();
    expect(screen.queryByLabelText(/Reason/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByLabelText(/Reason/)).toBeInTheDocument();
    expect(getCorrectPlanEligibilityAction).toHaveBeenCalledTimes(2);
  });

  describe("submit", () => {
    it("calls the action with the plan, the trimmed reason and the subscription the modal showed, then reports the result", async () => {
      getCorrectPlanEligibilityAction.mockResolvedValue(eligibility());
      correctPlanAction.mockResolvedValue({
        data: { subscriptionId: SUB_ID, planId: "p-monthly", planName: "MONTHLY", planType: "monthly", expiryDate: "2026-12-02", status: "active" },
        refusal: null,
        permissionDenied: false,
        error: null,
      });
      const user = userEvent.setup();
      const { onCorrected } = renderModal();
      await fillAndSubmit(user, "p-monthly", "  Wrong plan chosen at sign-up  ");
      await waitFor(() => expect(onCorrected).toHaveBeenCalledWith({ planName: "MONTHLY", planType: "monthly", expiryDate: "2026-12-02", status: "active" }));
      expect(correctPlanAction).toHaveBeenCalledWith({
        memberId: MEMBER_FIXTURE.id,
        newPlanId: "p-monthly",
        subscriptionId: SUB_ID,
        reason: "Wrong plan chosen at sign-up",
      });
    });

    it("a payment that landed meanwhile renders the matching blocked state (not shown at open)", async () => {
      getCorrectPlanEligibilityAction.mockResolvedValue(eligibility());
      correctPlanAction.mockResolvedValue({
        data: null,
        refusal: { code: "payment_stands", block: { ...standing("pending"), more: 0 } },
        permissionDenied: false,
        error: null,
      });
      const user = userEvent.setup();
      renderModal();
      await fillAndSubmit(user);
      expect(await screen.findByRole("alert")).toHaveTextContent("is awaiting verification");
      expect(screen.getByRole("link", { name: "Open payments" })).toBeInTheDocument();
      expect(screen.queryByLabelText(/Reason/)).not.toBeInTheDocument();
    });

    it("F6: an unused paid session shows the lapse date and [Open payments] for sessions", async () => {
      getCorrectPlanEligibilityAction.mockResolvedValue(eligibility());
      correctPlanAction.mockResolvedValue({ data: null, refusal: { code: "session_held", lapsesOn: "2026-11-20" }, permissionDenied: false, error: null });
      const user = userEvent.setup();
      renderModal();
      await fillAndSubmit(user, "p-dropin");
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Can't move Ange T. to or from Pay-per-session while an unused paid session is held. Refund it first, or wait until it is used or lapses (20 Nov 2026).",
      );
      expect(screen.getByRole("link", { name: "Open payments" })).toHaveAttribute("href", `/payments?memberId=${MEMBER_FIXTURE.id}&purpose=session`);
    });

    it("F7: already on that plan returns to the form with the field marked", async () => {
      getCorrectPlanEligibilityAction.mockResolvedValue(eligibility());
      correctPlanAction.mockResolvedValue({ data: null, refusal: { code: "same_plan" }, permissionDenied: false, error: null });
      const user = userEvent.setup();
      renderModal();
      await fillAndSubmit(user);
      expect(await screen.findByText("Ange T. is already on this plan.")).toBeInTheDocument();
      expect(screen.getByLabelText(/New plan/)).toHaveAttribute("aria-invalid", "true");
      expect(screen.getByLabelText(/Reason/)).toBeInTheDocument();
    });

    it("F8 on submit: no current plan, [Close] only", async () => {
      getCorrectPlanEligibilityAction.mockResolvedValue(eligibility());
      correctPlanAction.mockResolvedValue({ data: null, refusal: { code: "no_current_subscription" }, permissionDenied: false, error: null });
      const user = userEvent.setup();
      renderModal();
      await fillAndSubmit(user);
      expect(await screen.findByRole("alert")).toHaveTextContent("Ange T. has no current plan to correct.");
    });

    it("F9: a plan deleted meanwhile returns to the form, the select refreshed without it", async () => {
      getCorrectPlanEligibilityAction.mockResolvedValue(eligibility());
      correctPlanAction.mockResolvedValue({ data: null, refusal: { code: "plan_not_found" }, permissionDenied: false, error: null });
      const user = userEvent.setup();
      renderModal();
      await fillAndSubmit(user, "p-monthly");
      expect(await screen.findByText("That plan is no longer available. Choose another.")).toBeInTheDocument();
      expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["Choose a plan", "DROP-IN · 2,000 XAF / session"]);
      expect(refresh).toHaveBeenCalled();
    });

    it("F10: the subscription changed meanwhile, [Close] only", async () => {
      getCorrectPlanEligibilityAction.mockResolvedValue(eligibility());
      correctPlanAction.mockResolvedValue({ data: null, refusal: { code: "subscription_changed" }, permissionDenied: false, error: null });
      const user = userEvent.setup();
      renderModal();
      await fillAndSubmit(user);
      expect(await screen.findByRole("alert")).toHaveTextContent("This member's plan changed while you were working. Close this window and open the member again.");
      expect(screen.queryByRole("link", { name: "Open payments" })).not.toBeInTheDocument();
    });

    it("F11: a network failure stays on the form, inline, with [Correct plan] still enabled", async () => {
      getCorrectPlanEligibilityAction.mockResolvedValue(eligibility());
      correctPlanAction.mockRejectedValue(new Error("offline"));
      const user = userEvent.setup();
      renderModal();
      await fillAndSubmit(user);
      expect(await screen.findByText("Couldn't correct the plan. Check your connection and try again.")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Correct plan" })).toBeEnabled();
      expect(screen.getByLabelText(/Reason/)).toHaveValue("Wrong plan chosen at sign-up");
    });

    it("F12: permission lost shows the global message and [Close]", async () => {
      getCorrectPlanEligibilityAction.mockResolvedValue(eligibility());
      correctPlanAction.mockResolvedValue({ data: null, refusal: null, permissionDenied: true, error: null });
      const user = userEvent.setup();
      renderModal();
      await fillAndSubmit(user);
      expect(await screen.findByRole("alert")).toHaveTextContent("You don't have permission to do that.");
      expect(screen.queryByLabelText(/Reason/)).not.toBeInTheDocument();
    });
  });

  describe("GymOS Support", () => {
    it("shows the bound-action line and the code field, and sends the code with the correction", async () => {
      getCorrectPlanEligibilityAction.mockResolvedValue(eligibility());
      correctPlanAction.mockResolvedValue({ data: null, refusal: { code: "same_plan" }, permissionDenied: false, error: null });
      const user = userEvent.setup();
      renderModal({ isSupport: true });
      await screen.findByLabelText(/New plan/);
      expect(screen.getByText("You're about to: Correct plan for Ange T.")).toBeInTheDocument();
      await user.selectOptions(screen.getByLabelText(/New plan/), "p-monthly");
      await user.type(screen.getByLabelText(/Reason/), "Wrong plan chosen at sign-up");
      expect(screen.getByRole("button", { name: "Correct plan" })).toBeDisabled();
      await user.type(screen.getByLabelText(/Authenticator code/), "123456");
      await user.click(screen.getByRole("button", { name: "Correct plan" }));
      await waitFor(() => expect(correctPlanAction).toHaveBeenCalled());
      expect(correctPlanAction.mock.calls[0][0]).toMatchObject({ authCode: "123456", memberId: MEMBER_FIXTURE.id });
    });

    it("a staff role sees no code field", async () => {
      getCorrectPlanEligibilityAction.mockResolvedValue(eligibility());
      renderModal();
      await screen.findByLabelText(/New plan/);
      expect(screen.queryByLabelText(/Authenticator code/)).not.toBeInTheDocument();
    });
  });

  describe("a failed step-up or a lost account", () => {
    async function submitAsSupport(result: unknown) {
      getCorrectPlanEligibilityAction.mockResolvedValue(eligibility());
      correctPlanAction.mockResolvedValue(result);
      const user = userEvent.setup();
      renderModal({ isSupport: true });
      await screen.findByLabelText(/New plan/);
      await user.selectOptions(screen.getByLabelText(/New plan/), "p-monthly");
      await user.type(screen.getByLabelText(/Reason/), "Wrong plan chosen at sign-up");
      await user.type(screen.getByLabelText(/Authenticator code/), "123456");
      await user.click(screen.getByRole("button", { name: "Correct plan" }));
    }

    it.each([
      ["invalid_code", "That code was not accepted. Try the current code."],
      ["code_required", "Enter the 6-digit authenticator code"],
      ["step_up_unavailable", "Couldn't confirm the code right now. Try again."],
    ])("%s shows the action's own message inline, not the network message", async (code, message) => {
      await submitAsSupport({ data: null, refusal: null, permissionDenied: false, error: { code, message } });
      expect(await screen.findByText(message)).toBeInTheDocument();
      expect(screen.queryByText("Couldn't correct the plan. Check your connection and try again.")).not.toBeInTheDocument();
      expect(screen.getByLabelText(/Reason/)).toBeInTheDocument();
    });

    it("account_locked ends the session (goToLoginExpired)", async () => {
      await submitAsSupport({ data: null, refusal: null, permissionDenied: false, error: { code: "account_locked", message: "locked" } });
      await waitFor(() => expect(goToLoginExpired).toHaveBeenCalledTimes(1));
    });
  });
});
