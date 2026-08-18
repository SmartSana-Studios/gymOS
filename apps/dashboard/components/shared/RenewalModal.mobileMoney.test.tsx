/**
 * Story 4.12 (Task 2, AC #1): component-level tests for RenewalModal's new
 * `mobile_money` branch -- the first real UI entry point for automated Tara
 * Money payment initiation. Mirrors
 * `MembersPageClient.sendInvite.test.tsx`'s established pattern (mock the
 * Server Action layer and Realtime helpers, render with React Testing
 * Library, drive the actual click/submit flow) since this app has no
 * Playwright/browser E2E setup. The existing manual-methods branch
 * (confirmRenewalAction) is Story 4.7/4.8's own already-covered concern and
 * is not re-tested here.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const getRenewalPreviewAction = vi.fn();
const confirmRenewalAction = vi.fn();
const initiatePaymentAction = vi.fn();
const getPendingMobileMoneyPaymentAction = vi.fn();
const dismissFrontDeskAlert = vi.fn();
const removeChannel = vi.fn();

// Captures the callbacks RenewalModal passes to subscribeToPaymentStatus so
// tests can simulate a Realtime delivery directly, without a real Supabase
// connection -- same technique this codebase has no prior precedent for
// (first Realtime-consuming component test), modeled on
// FrontDeskAlertPanel's own subscribeToFrontDeskAlerts callback shape.
let capturedOnUpdate: ((row: { id: string; status: string }) => void) | null = null;

vi.mock("@/lib/realtime/paymentStatus", () => ({
  subscribeToPaymentStatus: (
    _paymentId: string,
    onUpdate: (row: { id: string; status: string }) => void,
    onStatusChange: (status: string) => void,
  ) => {
    capturedOnUpdate = onUpdate;
    onStatusChange("SUBSCRIBED");
    return { topic: "payment:test:status" };
  },
  fetchPaymentStatus: vi.fn(async () => null),
}));

vi.mock("@/lib/realtime/frontDeskAlerts", () => ({
  dismissFrontDeskAlert: (...args: unknown[]) => dismissFrontDeskAlert(...args),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ removeChannel: (...args: unknown[]) => removeChannel(...args) }),
}));

vi.mock("@/app/(dashboard)/subscriptions/actions", () => ({
  getRenewalPreviewAction: (...args: unknown[]) => getRenewalPreviewAction(...args),
  confirmRenewalAction: (...args: unknown[]) => confirmRenewalAction(...args),
}));

vi.mock("@/app/(dashboard)/payments/actions", () => ({
  initiatePaymentAction: (...args: unknown[]) => initiatePaymentAction(...args),
  getPendingMobileMoneyPaymentAction: (...args: unknown[]) => getPendingMobileMoneyPaymentAction(...args),
}));

const TRANSLATIONS: Record<string, string> = {
  "renewalPanel.method": "Payment method",
  "renewalPanel.sendPaymentRequestButton": "Send Payment Request",
  "renewalPanel.sendingPaymentRequest": "Sending…",
  "renewalPanel.confirmButton": "Confirm Renewal",
  "renewalPanel.pending.failed": "The payment was not approved or was declined.",
  "renewalPanel.pending.closeButton": "Close",
  "renewalPanel.payerPhone": "Payer's phone number",
  "renewalPanel.payerPhoneHint": "Defaults to the member's number on file — edit it if they're paying from a different phone.",
  "renewalPanel.errors.payerPhoneInvalid": "Enter a valid phone number",
  "renewalPanel.errors.initiateFailed": "Couldn't send the payment request.",
  "payments.methods.cash": "Cash",
  "payments.methods.bankTransfer": "Bank Transfer",
  "payments.methods.manualMomo": "Manual Mobile Money",
  "payments.methods.mobileMoney": "Mobile Money (Tara Money)",
  "common.cancel": "Cancel",
};

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) => {
      if (key === "renewalPanel.pending.title") return `Waiting for ${vars?.name} to approve on their phone…`;
      return TRANSLATIONS[key] ?? key;
    },
    i18n: { language: "en" },
  }),
}));

const MEMBER_ID = "member-1";

async function renderModal(overrides?: { mobileMoneyEnabled?: boolean; alertId?: string }) {
  const { RenewalModal } = await import("./RenewalModal");
  render(
    <RenewalModal
      alertId={overrides?.alertId}
      memberId={MEMBER_ID}
      memberName="Alice"
      mobileMoneyEnabled={overrides?.mobileMoneyEnabled ?? true}
      onClose={vi.fn()}
      onRenewed={vi.fn()}
    />,
  );
}

describe("RenewalModal - mobile_money (Story 4.12)", () => {
  beforeEach(() => {
    getRenewalPreviewAction.mockReset();
    confirmRenewalAction.mockReset();
    initiatePaymentAction.mockReset();
    getPendingMobileMoneyPaymentAction.mockReset();
    getPendingMobileMoneyPaymentAction.mockResolvedValue({ data: null, error: null });
    dismissFrontDeskAlert.mockReset();
    removeChannel.mockReset();
    capturedOnUpdate = null;

    getRenewalPreviewAction.mockResolvedValue({
      data: { planName: "Monthly", price: 15000, currency: "XAF", memberPhone: "+237680811041" },
      error: null,
    });
  });

  it("AC #4: does not offer the Mobile Money option when mobileMoneyEnabled is false", async () => {
    await renderModal({ mobileMoneyEnabled: false });

    await waitFor(() => expect(screen.getByRole("combobox")).toBeEnabled());
    expect(screen.queryByRole("option", { name: "Mobile Money (Tara Money)" })).not.toBeInTheDocument();
  });

  it("AC #1: offers the Mobile Money option when mobileMoneyEnabled is true", async () => {
    await renderModal({ mobileMoneyEnabled: true });

    await waitFor(() => expect(screen.getByRole("combobox")).toBeEnabled());
    expect(screen.getByRole("option", { name: "Mobile Money (Tara Money)" })).toBeInTheDocument();
  });

  it("Review finding (Story 4.12): resumes watching an already-processing mobile_money payment on open instead of showing the form", async () => {
    getPendingMobileMoneyPaymentAction.mockResolvedValue({ data: { paymentId: "payment-existing" }, error: null });
    await renderModal();

    expect(await screen.findByText(/waiting for alice to approve/i)).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(initiatePaymentAction).not.toHaveBeenCalled();
  });

  it("Review finding (Story 4.12): does not check for an existing payment when Mobile Money is disabled", async () => {
    await renderModal({ mobileMoneyEnabled: false });

    await waitFor(() => expect(screen.getByRole("combobox")).toBeEnabled());
    expect(getPendingMobileMoneyPaymentAction).not.toHaveBeenCalled();
  });

  it("Review finding (Story 4.12): retryBlocked from a failed manual attempt no longer disables Send Payment Request after switching methods", async () => {
    // memberId must be a real uuid here (unlike the shared MEMBER_ID fixture)
    // -- confirmRenewalSchema validates it and this test needs to actually
    // reach confirmRenewalAction's catch branch, not fail parsing earlier.
    confirmRenewalAction.mockRejectedValue(new Error("network down"));
    const { RenewalModal } = await import("./RenewalModal");
    const user = userEvent.setup();
    render(
      <RenewalModal
        memberId="3fa85f64-5717-4562-b3fc-2c963f66afa6"
        memberName="Alice"
        mobileMoneyEnabled
        onClose={vi.fn()}
        onRenewed={vi.fn()}
      />,
    );

    await waitFor(() => expect(screen.getByRole("combobox")).toBeEnabled());
    await user.click(screen.getByRole("button", { name: /confirm renewal/i }));
    await waitFor(() => expect(screen.getByRole("button", { name: /confirm renewal/i })).toBeDisabled());

    await user.selectOptions(screen.getByRole("combobox"), "mobile_money");

    expect(screen.getByRole("button", { name: /send payment request/i })).toBeEnabled();
  });

  it("AC #1: selecting Mobile Money and submitting calls initiatePaymentAction with the member's phone, then shows the pending state", async () => {
    initiatePaymentAction.mockResolvedValue({ data: { paymentId: "payment-1" }, error: null });
    const user = userEvent.setup();
    await renderModal();

    await waitFor(() => expect(screen.getByRole("combobox")).toBeEnabled());
    await user.selectOptions(screen.getByRole("combobox"), "mobile_money");
    await user.click(screen.getByRole("button", { name: /send payment request/i }));

    await waitFor(() =>
      expect(initiatePaymentAction).toHaveBeenCalledWith({
        memberId: MEMBER_ID,
        phoneNumber: "+237680811041",
        method: "mobile_money",
      }),
    );
    expect(await screen.findByText(/waiting for alice to approve/i)).toBeInTheDocument();
    // The method selector/submit button are gone -- replaced by the pending
    // panel, not co-rendered alongside it.
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("pre-fills the payer phone field with the member's registered number", async () => {
    await renderModal();

    await waitFor(() => expect(screen.getByRole("combobox")).toBeEnabled());
    await userEvent.setup().selectOptions(screen.getByRole("combobox"), "mobile_money");

    expect(screen.getByLabelText(/payer's phone number/i)).toHaveValue("+237680811041");
  });

  it("shows a field error and never calls initiatePaymentAction when the member has no phone on file and the front desk submits without entering one", async () => {
    getRenewalPreviewAction.mockResolvedValue({
      data: { planName: "Monthly", price: 15000, currency: "XAF", memberPhone: null },
      error: null,
    });
    const user = userEvent.setup();
    await renderModal();

    await waitFor(() => expect(screen.getByRole("combobox")).toBeEnabled());
    await user.selectOptions(screen.getByRole("combobox"), "mobile_money");
    // Defaults to just the "+237" prefix with no subscriber number -- too
    // short to pass validation, same as leaving the field untouched.
    await user.click(screen.getByRole("button", { name: /send payment request/i }));

    expect(await screen.findByText(/enter a valid phone number/i)).toBeInTheDocument();
    expect(initiatePaymentAction).not.toHaveBeenCalled();
  });

  it("lets the front desk override the payer phone with a different number than the one on file", async () => {
    initiatePaymentAction.mockResolvedValue({ data: { paymentId: "payment-1" }, error: null });
    const user = userEvent.setup();
    await renderModal();

    await waitFor(() => expect(screen.getByRole("combobox")).toBeEnabled());
    await user.selectOptions(screen.getByRole("combobox"), "mobile_money");

    const phoneInput = screen.getByLabelText(/payer's phone number/i);
    await user.clear(phoneInput);
    await user.type(phoneInput, "+237691234567");
    await user.click(screen.getByRole("button", { name: /send payment request/i }));

    await waitFor(() =>
      expect(initiatePaymentAction).toHaveBeenCalledWith({
        memberId: MEMBER_ID,
        phoneNumber: "+237691234567",
        method: "mobile_money",
      }),
    );
  });

  it("on initiatePaymentAction error, shows an error and returns to the form (method selector reappears)", async () => {
    initiatePaymentAction.mockResolvedValue({ data: null, error: { code: "not_found", message: "disabled" } });
    const user = userEvent.setup();
    await renderModal();

    await waitFor(() => expect(screen.getByRole("combobox")).toBeEnabled());
    await user.selectOptions(screen.getByRole("combobox"), "mobile_money");
    await user.click(screen.getByRole("button", { name: /send payment request/i }));

    expect(await screen.findByText("disabled")).toBeInTheDocument();
    expect(screen.getByRole("combobox")).toBeInTheDocument();
  });

  it("AC #1: a Realtime 'verified' update calls onRenewed and dismisses the front-desk alert", async () => {
    initiatePaymentAction.mockResolvedValue({ data: { paymentId: "payment-1" }, error: null });
    dismissFrontDeskAlert.mockResolvedValue({ error: null });
    const onRenewed = vi.fn();
    const { RenewalModal } = await import("./RenewalModal");
    const user = userEvent.setup();
    render(
      <RenewalModal
        alertId="alert-1"
        memberId={MEMBER_ID}
        memberName="Alice"
        mobileMoneyEnabled
        onClose={vi.fn()}
        onRenewed={onRenewed}
      />,
    );

    await waitFor(() => expect(screen.getByRole("combobox")).toBeEnabled());
    await user.selectOptions(screen.getByRole("combobox"), "mobile_money");
    await user.click(screen.getByRole("button", { name: /send payment request/i }));
    await waitFor(() => expect(capturedOnUpdate).not.toBeNull());

    capturedOnUpdate?.({ id: "payment-1", status: "verified" });

    await waitFor(() => expect(dismissFrontDeskAlert).toHaveBeenCalledWith("alert-1"));
    await waitFor(() => expect(onRenewed).toHaveBeenCalled());
  });

  it("a Realtime 'flagged' update shows the failed state instead of closing", async () => {
    initiatePaymentAction.mockResolvedValue({ data: { paymentId: "payment-1" }, error: null });
    const onRenewed = vi.fn();
    const { RenewalModal } = await import("./RenewalModal");
    const user = userEvent.setup();
    render(
      <RenewalModal
        memberId={MEMBER_ID}
        memberName="Alice"
        mobileMoneyEnabled
        onClose={vi.fn()}
        onRenewed={onRenewed}
      />,
    );

    await waitFor(() => expect(screen.getByRole("combobox")).toBeEnabled());
    await user.selectOptions(screen.getByRole("combobox"), "mobile_money");
    await user.click(screen.getByRole("button", { name: /send payment request/i }));
    await waitFor(() => expect(capturedOnUpdate).not.toBeNull());

    capturedOnUpdate?.({ id: "payment-1", status: "flagged" });

    expect(await screen.findByText(/not approved or was declined/i)).toBeInTheDocument();
    expect(onRenewed).not.toHaveBeenCalled();
  });

  it("the pending panel's Close button remains enabled and calls onClose, unlike the brief 'sending' phase", async () => {
    initiatePaymentAction.mockResolvedValue({ data: { paymentId: "payment-1" }, error: null });
    const onClose = vi.fn();
    const { RenewalModal } = await import("./RenewalModal");
    const user = userEvent.setup();
    render(
      <RenewalModal memberId={MEMBER_ID} memberName="Alice" mobileMoneyEnabled onClose={onClose} onRenewed={vi.fn()} />,
    );

    await waitFor(() => expect(screen.getByRole("combobox")).toBeEnabled());
    await user.selectOptions(screen.getByRole("combobox"), "mobile_money");
    await user.click(screen.getByRole("button", { name: /send payment request/i }));
    await screen.findByText(/waiting for alice to approve/i);

    const closeButton = screen.getByRole("button", { name: "Close" });
    expect(closeButton).toBeEnabled();
    await user.click(closeButton);
    expect(onClose).toHaveBeenCalled();
  });
});
