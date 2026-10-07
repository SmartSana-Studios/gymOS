/**
 * Story 18.6: the registration fee collection dialog. Manual methods settle at
 * once; Tara Money (only when offered) waits for the webhook, resumes a request
 * still processing on open without a second initiate, offers a retry for a stale
 * or flagged one. Modeled on RenewalModal.mobileMoney.test.tsx.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const recordRegistrationFeeAction = vi.fn();
const initiateRegistrationFeePaymentAction = vi.fn();
const getPendingRegistrationFeePaymentAction = vi.fn();
const removeChannel = vi.fn();

let capturedOnUpdate: ((row: { id: string; status: string }) => void) | null = null;
let capturedOnStatusChange: ((status: string) => void) | null = null;
let subscribeStatus = "SUBSCRIBED";
const fetchPaymentStatus = vi.fn();

vi.mock("@/lib/realtime/paymentStatus", () => ({
  subscribeToPaymentStatus: (
    _paymentId: string,
    onUpdate: (row: { id: string; status: string }) => void,
    onStatusChange: (status: string) => void,
  ) => {
    capturedOnUpdate = onUpdate;
    capturedOnStatusChange = onStatusChange;
    onStatusChange(subscribeStatus);
    return { topic: "payment:test:status" };
  },
  fetchPaymentStatus: (...args: unknown[]) => fetchPaymentStatus(...args),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ removeChannel: (...args: unknown[]) => removeChannel(...args) }),
}));

vi.mock("@/app/(dashboard)/payments/actions", () => ({
  recordRegistrationFeeAction: (...args: unknown[]) => recordRegistrationFeeAction(...args),
  initiateRegistrationFeePaymentAction: (...args: unknown[]) => initiateRegistrationFeePaymentAction(...args),
  getPendingRegistrationFeePaymentAction: (...args: unknown[]) => getPendingRegistrationFeePaymentAction(...args),
}));

const TRANSLATIONS: Record<string, string> = {
  "members.feeCollect.method": "Payment method",
  "members.feeCollect.reason": "Note *",
  "members.feeCollect.reasonPrefill": "Registration fee",
  "members.feeCollect.collectButton": "Collect fee",
  "members.feeCollect.sendRequestButton": "Send payment request",
  "members.feeCollect.retryRequestButton": "Retry payment request",
  "members.feeCollect.payerPhone": "Payer's phone number",
  "members.feeCollect.pending.failed": "The payment was not approved or was declined.",
  "members.feeCollect.pending.retryButton": "Try again",
  "members.feeCollect.pending.expired": "The last payment request has expired.",
  "members.feeCollect.pending.closeButton": "Close",
  "members.feeCollect.pending.stillWaiting": "Still waiting.",
  "members.feeCollect.errors.reasonInvalid": "Add a note (10 to 200 characters)",
  "members.feeCollect.errors.payerPhoneInvalid": "Enter a valid phone number",
  "payments.methods.cash": "Cash",
  "payments.methods.bankTransfer": "Bank Transfer",
  "payments.methods.manualMomo": "Manual Mobile Money",
  "payments.methods.mobileMoney": "Mobile Money (Tara Money)",
  "common.cancel": "Cancel",
  "phoneInput.selectCountry": "Select country",
  "phoneInput.searchCountry": "Search country...",
  "phoneInput.noCountryFound": "No country found",
};

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) => {
      if (key === "members.feeCollect.pending.title") return `Waiting for ${vars?.name} to approve on their phone…`;
      if (key === "members.feeCollect.amountValue") return `${vars?.amount} XAF`;
      return TRANSLATIONS[key] ?? key;
    },
    i18n: { language: "en" },
  }),
}));

const MEMBER_FIXTURE = {
  id: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  name: "Alice",
  phone: "+237680811041",
};
const MEMBER = MEMBER_FIXTURE as never;

async function renderDialog(overrides?: { mobileMoneyEnabled?: boolean }) {
  const { CollectRegistrationFeeDialog } = await import("./CollectRegistrationFeeDialog");
  const onCollected = vi.fn();
  const onClose = vi.fn();
  render(
    <CollectRegistrationFeeDialog
      member={MEMBER}
      registrationFee={5000}
      mobileMoneyEnabled={overrides?.mobileMoneyEnabled ?? true}
      onClose={onClose}
      onCollected={onCollected}
    />,
  );
  await waitFor(() => expect(screen.getByRole("button", { name: /collect fee|send payment request|retry payment request/i })).toBeEnabled());
  return { onCollected, onClose };
}

describe("CollectRegistrationFeeDialog (Story 18.6)", () => {
  beforeEach(() => {
    recordRegistrationFeeAction.mockReset();
    initiateRegistrationFeePaymentAction.mockReset();
    getPendingRegistrationFeePaymentAction.mockReset();
    getPendingRegistrationFeePaymentAction.mockResolvedValue({ data: null, error: null });
    removeChannel.mockReset();
    capturedOnUpdate = null;
    capturedOnStatusChange = null;
    subscribeStatus = "SUBSCRIBED";
    fetchPaymentStatus.mockReset().mockResolvedValue(null);
    vi.useRealTimers();
  });

  it("shows the fee read-only and prefills the reason with 'Registration fee', editable", async () => {
    const user = userEvent.setup();
    await renderDialog();

    expect(screen.getByText("5,000 XAF")).toBeInTheDocument();
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
    const reason = screen.getByLabelText("Note *");
    expect(reason).toHaveValue("Registration fee");
    await user.clear(reason);
    await user.type(reason, "Paid at the desk in cash");
    expect(reason).toHaveValue("Paid at the desk in cash");
  });

  it("collects by cash: sends member, method and reason only (no amount), then calls onCollected", async () => {
    recordRegistrationFeeAction.mockResolvedValue({ data: { paymentId: "pay-1" }, error: null });
    const user = userEvent.setup();
    const { onCollected } = await renderDialog();

    await user.click(screen.getByRole("button", { name: "Collect fee" }));

    await waitFor(() =>
      expect(recordRegistrationFeeAction).toHaveBeenCalledWith({
        memberId: MEMBER_FIXTURE.id,
        method: "cash",
        reason: "Registration fee",
      }),
    );
    await waitFor(() => expect(onCollected).toHaveBeenCalled());
  });

  it("collects by bank transfer and manual mobile money with the chosen method", async () => {
    recordRegistrationFeeAction.mockResolvedValue({ data: { paymentId: "pay-1" }, error: null });
    const user = userEvent.setup();
    await renderDialog();

    await user.selectOptions(screen.getByRole("combobox", { name: "Payment method" }), "manual_momo");
    await user.click(screen.getByRole("button", { name: "Collect fee" }));

    await waitFor(() =>
      expect(recordRegistrationFeeAction).toHaveBeenCalledWith(expect.objectContaining({ method: "manual_momo" })),
    );
  });

  it("a short reason shows a field error and never calls the action", async () => {
    const user = userEvent.setup();
    await renderDialog();

    const reason = screen.getByLabelText("Note *");
    await user.clear(reason);
    await user.type(reason, "short");
    await user.click(screen.getByRole("button", { name: "Collect fee" }));

    expect(await screen.findByText("Add a note (10 to 200 characters)")).toBeInTheDocument();
    expect(recordRegistrationFeeAction).not.toHaveBeenCalled();
  });

  it("shows the mapped error and stays open when the action fails", async () => {
    recordRegistrationFeeAction.mockResolvedValue({
      data: null,
      error: { code: "registration_fee_already_recorded", message: "Already paid." },
    });
    const user = userEvent.setup();
    const { onCollected } = await renderDialog();

    await user.click(screen.getByRole("button", { name: "Collect fee" }));

    expect(await screen.findByText("Already paid.")).toBeInTheDocument();
    expect(onCollected).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Collect fee" })).toBeEnabled();
  });

  it("disables the submit while the manual call is pending", async () => {
    let resolveCall: (value: unknown) => void = () => {};
    recordRegistrationFeeAction.mockReturnValue(new Promise((resolve) => (resolveCall = resolve)));
    const user = userEvent.setup();
    await renderDialog();

    await user.click(screen.getByRole("button", { name: "Collect fee" }));

    const pendingButton = await screen.findByRole("button", { name: "members.feeCollect.collecting" });
    expect(pendingButton).toBeDisabled();
    await user.click(pendingButton);
    expect(recordRegistrationFeeAction).toHaveBeenCalledTimes(1);
    resolveCall({ data: { paymentId: "pay-1" }, error: null });
  });

  it("does not offer Tara Money when it is not available", async () => {
    await renderDialog({ mobileMoneyEnabled: false });

    expect(screen.queryByRole("option", { name: "Mobile Money (Tara Money)" })).not.toBeInTheDocument();
  });

  it("offers Tara Money when available, and initiates with the member's phone, then waits", async () => {
    initiateRegistrationFeePaymentAction.mockResolvedValue({ data: { paymentId: "pay-tara" }, error: null });
    const user = userEvent.setup();
    await renderDialog();

    await user.selectOptions(screen.getByRole("combobox", { name: "Payment method" }), "mobile_money");
    expect(screen.getByLabelText(/payer's phone number/i)).toHaveValue("680811041");
    await user.click(screen.getByRole("button", { name: "Send payment request" }));

    await waitFor(() =>
      expect(initiateRegistrationFeePaymentAction).toHaveBeenCalledWith({
        memberId: MEMBER_FIXTURE.id,
        phoneNumber: "+237680811041",
      }),
    );
    expect(await screen.findByText(/waiting for alice to approve/i)).toBeInTheDocument();
    expect(recordRegistrationFeeAction).not.toHaveBeenCalled();
  });

  it("settles the member when the Tara payment verifies", async () => {
    initiateRegistrationFeePaymentAction.mockResolvedValue({ data: { paymentId: "pay-tara" }, error: null });
    const user = userEvent.setup();
    const { onCollected } = await renderDialog();

    await user.selectOptions(screen.getByRole("combobox", { name: "Payment method" }), "mobile_money");
    await user.click(screen.getByRole("button", { name: "Send payment request" }));
    await waitFor(() => expect(capturedOnUpdate).not.toBeNull());

    capturedOnUpdate?.({ id: "pay-tara", status: "verified" });

    await waitFor(() => expect(onCollected).toHaveBeenCalled());
  });

  it("a flagged Tara payment shows an error and a retry that returns to the form", async () => {
    initiateRegistrationFeePaymentAction.mockResolvedValue({ data: { paymentId: "pay-tara" }, error: null });
    const user = userEvent.setup();
    const { onCollected } = await renderDialog();

    await user.selectOptions(screen.getByRole("combobox", { name: "Payment method" }), "mobile_money");
    await user.click(screen.getByRole("button", { name: "Send payment request" }));
    await waitFor(() => expect(capturedOnUpdate).not.toBeNull());
    capturedOnUpdate?.({ id: "pay-tara", status: "flagged" });

    expect(await screen.findByText(/not approved or was declined/i)).toBeInTheDocument();
    expect(onCollected).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByRole("button", { name: "Send payment request" })).toBeEnabled();
  });

  it("shows a mapped error and stays on the form when the initiate fails", async () => {
    initiateRegistrationFeePaymentAction.mockResolvedValue({
      data: null,
      error: { code: "registration_fee_already_pending", message: "A payment is already in progress." },
    });
    const user = userEvent.setup();
    await renderDialog();

    await user.selectOptions(screen.getByRole("combobox", { name: "Payment method" }), "mobile_money");
    await user.click(screen.getByRole("button", { name: "Send payment request" }));

    expect(await screen.findByText("A payment is already in progress.")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Payment method" })).toBeInTheDocument();
  });

  it("rejects an invalid payer phone without initiating", async () => {
    const user = userEvent.setup();
    const { CollectRegistrationFeeDialog } = await import("./CollectRegistrationFeeDialog");
    render(
      <CollectRegistrationFeeDialog
        member={{ ...(MEMBER as object), phone: null } as never}
        registrationFee={5000}
        mobileMoneyEnabled
        onClose={vi.fn()}
        onCollected={vi.fn()}
      />,
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "Collect fee" })).toBeEnabled());

    await user.selectOptions(screen.getByRole("combobox", { name: "Payment method" }), "mobile_money");
    await user.click(screen.getByRole("button", { name: "Send payment request" }));

    expect(await screen.findByText("Enter a valid phone number")).toBeInTheDocument();
    expect(initiateRegistrationFeePaymentAction).not.toHaveBeenCalled();
  });

  it("reopened while a request is under 10 minutes old: shows the waiting state and never initiates again", async () => {
    getPendingRegistrationFeePaymentAction.mockResolvedValue({
      data: { paymentId: "pay-existing", createdAt: new Date(Date.now() - 2 * 60 * 1000).toISOString() },
      error: null,
    });
    const { CollectRegistrationFeeDialog } = await import("./CollectRegistrationFeeDialog");
    render(
      <CollectRegistrationFeeDialog
        member={MEMBER}
        registrationFee={5000}
        mobileMoneyEnabled
        onClose={vi.fn()}
        onCollected={vi.fn()}
      />,
    );

    expect(await screen.findByText(/waiting for alice to approve/i)).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Send payment request" })).not.toBeInTheDocument();
    expect(initiateRegistrationFeePaymentAction).not.toHaveBeenCalled();
  });

  it("a request 10 minutes or older offers a retry notice and a retry button, not a wait", async () => {
    getPendingRegistrationFeePaymentAction.mockResolvedValue({
      data: { paymentId: "pay-old", createdAt: new Date(Date.now() - 10 * 60 * 1000 - 1000).toISOString() },
      error: null,
    });
    initiateRegistrationFeePaymentAction.mockResolvedValue({ data: { paymentId: "pay-new" }, error: null });
    const user = userEvent.setup();
    const { CollectRegistrationFeeDialog } = await import("./CollectRegistrationFeeDialog");
    render(
      <CollectRegistrationFeeDialog
        member={MEMBER}
        registrationFee={5000}
        mobileMoneyEnabled
        onClose={vi.fn()}
        onCollected={vi.fn()}
      />,
    );

    expect(await screen.findByText("The last payment request has expired.")).toBeInTheDocument();
    expect(screen.queryByText(/waiting for alice/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Retry payment request" }));

    await waitFor(() => expect(initiateRegistrationFeePaymentAction).toHaveBeenCalledTimes(1));
  });

  it("with Tara off and a 10+ minute processing row: shows the manual form and no expiry notice", async () => {
    getPendingRegistrationFeePaymentAction.mockResolvedValue({
      data: { paymentId: "pay-old", createdAt: new Date(Date.now() - 11 * 60 * 1000).toISOString() },
      error: null,
    });
    await renderDialog({ mobileMoneyEnabled: false });

    expect(screen.queryByText("The last payment request has expired.")).not.toBeInTheDocument();
    expect(screen.queryByText(/waiting for alice/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Collect fee" })).toBeEnabled();
    expect(screen.queryByRole("option", { name: "Mobile Money (Tara Money)" })).not.toBeInTheDocument();
  });

  it("Try again with Tara off (a resumed row flagged) returns to a manual form with a valid method", async () => {
    getPendingRegistrationFeePaymentAction.mockResolvedValue({
      data: { paymentId: "pay-existing", createdAt: new Date(Date.now() - 60 * 1000).toISOString() },
      error: null,
    });
    const user = userEvent.setup();
    const { CollectRegistrationFeeDialog } = await import("./CollectRegistrationFeeDialog");
    render(
      <CollectRegistrationFeeDialog
        member={MEMBER}
        registrationFee={5000}
        mobileMoneyEnabled={false}
        onClose={vi.fn()}
        onCollected={vi.fn()}
      />,
    );
    await screen.findByText(/waiting for alice/i);
    await waitFor(() => expect(capturedOnUpdate).not.toBeNull());
    capturedOnUpdate?.({ id: "pay-existing", status: "flagged" });
    await user.click(await screen.findByRole("button", { name: "Try again" }));

    expect(screen.getByRole("combobox", { name: "Payment method" })).toHaveValue("cash");
    expect(screen.getByRole("button", { name: "Collect fee" })).toBeEnabled();
  });

  it("on SUBSCRIBED reads the payment once, so a payment settled before the channel was ready is seen", async () => {
    getPendingRegistrationFeePaymentAction.mockResolvedValue({
      data: { paymentId: "pay-existing", createdAt: new Date(Date.now() - 60 * 1000).toISOString() },
      error: null,
    });
    fetchPaymentStatus.mockResolvedValue({ id: "pay-existing", status: "verified" });
    const { CollectRegistrationFeeDialog } = await import("./CollectRegistrationFeeDialog");
    const onCollected = vi.fn();
    render(
      <CollectRegistrationFeeDialog
        member={MEMBER}
        registrationFee={5000}
        mobileMoneyEnabled
        onClose={vi.fn()}
        onCollected={onCollected}
      />,
    );

    await waitFor(() => expect(onCollected).toHaveBeenCalled());
    expect(fetchPaymentStatus).toHaveBeenCalledTimes(1);
    expect(fetchPaymentStatus).toHaveBeenCalledWith("pay-existing");
  });

  describe("polling fallback and timers", () => {
    async function renderResumed(onCollected = vi.fn()) {
      getPendingRegistrationFeePaymentAction.mockResolvedValue({
        data: { paymentId: "pay-existing", createdAt: new Date(Date.now() - 60 * 1000).toISOString() },
        error: null,
      });
      const { CollectRegistrationFeeDialog } = await import("./CollectRegistrationFeeDialog");
      render(
        <CollectRegistrationFeeDialog
          member={MEMBER}
          registrationFee={5000}
          mobileMoneyEnabled
          onClose={vi.fn()}
          onCollected={onCollected}
        />,
      );
      await screen.findByText(/waiting for alice/i);
      return onCollected;
    }

    it("when the channel does not subscribe, polls and settles on a verified row", async () => {
      subscribeStatus = "CHANNEL_ERROR";
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const onCollected = await renderResumed();
      expect(fetchPaymentStatus).not.toHaveBeenCalled();
      fetchPaymentStatus.mockResolvedValue({ id: "pay-existing", status: "verified" });

      await vi.advanceTimersByTimeAsync(5000);

      await waitFor(() => expect(onCollected).toHaveBeenCalled());
      expect(fetchPaymentStatus).toHaveBeenCalledWith("pay-existing");
    });

    it("when polling sees a flagged row it shows the failed state", async () => {
      subscribeStatus = "CHANNEL_ERROR";
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const onCollected = await renderResumed();
      fetchPaymentStatus.mockResolvedValue({ id: "pay-existing", status: "flagged" });

      await vi.advanceTimersByTimeAsync(5000);

      expect(await screen.findByText(/not approved or was declined/i)).toBeInTheDocument();
      expect(onCollected).not.toHaveBeenCalled();
    });

    it("a CLOSED report during cleanup does not leave a polling interval running", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      getPendingRegistrationFeePaymentAction.mockResolvedValue({
        data: { paymentId: "pay-existing", createdAt: new Date(Date.now() - 60 * 1000).toISOString() },
        error: null,
      });
      const { CollectRegistrationFeeDialog } = await import("./CollectRegistrationFeeDialog");
      const { unmount } = render(
        <CollectRegistrationFeeDialog
          member={MEMBER}
          registrationFee={5000}
          mobileMoneyEnabled
          onClose={vi.fn()}
          onCollected={vi.fn()}
        />,
      );
      await screen.findByText(/waiting for alice/i);
      removeChannel.mockImplementation(() => capturedOnStatusChange?.("CLOSED"));
      fetchPaymentStatus.mockClear();

      unmount();
      await vi.advanceTimersByTimeAsync(20_000);

      expect(removeChannel).toHaveBeenCalled();
      expect(fetchPaymentStatus).not.toHaveBeenCalled();
    });

    it("shows the still-waiting text after 45 seconds", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      await renderResumed();
      expect(screen.queryByText("Still waiting.")).not.toBeInTheDocument();

      await vi.advanceTimersByTimeAsync(45_000);

      expect(await screen.findByText("Still waiting.")).toBeInTheDocument();
    });
  });

  it("Try again after a flagged payment leads to a second initiate call", async () => {
    initiateRegistrationFeePaymentAction.mockResolvedValue({ data: { paymentId: "pay-tara" }, error: null });
    const user = userEvent.setup();
    await renderDialog();

    await user.selectOptions(screen.getByRole("combobox", { name: "Payment method" }), "mobile_money");
    await user.click(screen.getByRole("button", { name: "Send payment request" }));
    await waitFor(() => expect(capturedOnUpdate).not.toBeNull());
    capturedOnUpdate?.({ id: "pay-tara", status: "flagged" });
    await user.click(await screen.findByRole("button", { name: "Try again" }));
    await user.click(await screen.findByRole("button", { name: "Send payment request" }));

    await waitFor(() => expect(initiateRegistrationFeePaymentAction).toHaveBeenCalledTimes(2));
  });
});
