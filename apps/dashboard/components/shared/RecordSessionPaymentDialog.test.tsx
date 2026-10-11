/**
 * Story 19.9b: the Record Session Payment panel. Amount fixed and read-only,
 * Cash default, Bank Transfer absent from the DOM for a receptionist, a single
 * RPC call on a double click, each refusal inline with the panel kept open,
 * tab order Method -> Note -> Record -> Cancel, and the alert dismissed on
 * success.
 */
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const recordSessionPaymentAction = vi.fn();
const getSessionPaymentPanelContextAction = vi.fn();
const dismissFrontDeskAlert = vi.fn();

vi.mock("@/app/(dashboard)/payments/actions", () => ({
  recordSessionPaymentAction: (...args: unknown[]) => recordSessionPaymentAction(...args),
  getSessionPaymentPanelContextAction: (...args: unknown[]) => getSessionPaymentPanelContextAction(...args),
}));
vi.mock("@/lib/realtime/frontDeskAlerts", () => ({
  dismissFrontDeskAlert: (...args: unknown[]) => dismissFrontDeskAlert(...args),
}));

const TRANSLATIONS: Record<string, string> = {
  "sessionPayment.amount": "Amount",
  "sessionPayment.amountHint": "Plan price — fixed",
  "sessionPayment.method": "Payment method",
  "sessionPayment.note": "Note (optional)",
  "sessionPayment.recordedBy": "Recorded by",
  "sessionPayment.recordButton": "Record session payment",
  "sessionPayment.recording": "Recording…",
  "payments.methods.cash": "Cash",
  "payments.methods.bankTransfer": "Bank Transfer",
  "payments.methods.manualMomo": "Manual Mobile Money",
  "common.cancel": "Cancel",
};
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      key === "sessionPayment.title"
        ? `Record session payment — ${vars?.name}`
        : key === "sessionPayment.noteCount"
          ? `${vars?.count} / 200`
          : (TRANSLATIONS[key] ?? key),
    i18n: { language: "en" },
  }),
}));

import { RecordSessionPaymentDialog } from "./RecordSessionPaymentDialog";

const MEMBER_ID = "3fa85f64-5717-4562-b3fc-2c963f66afa6";

async function renderDialog(props?: { role?: string; alertId?: string }) {
  const onClose = vi.fn();
  const onRecorded = vi.fn();
  render(
    <RecordSessionPaymentDialog
      memberId={MEMBER_ID}
      memberName="Alice"
      role={props?.role ?? "receptionist"}
      alertId={props?.alertId}
      onClose={onClose}
      onRecorded={onRecorded}
    />,
  );
  await waitFor(() => expect(screen.getByRole("button", { name: "Record session payment" })).toBeEnabled());
  return { onClose, onRecorded };
}

describe("RecordSessionPaymentDialog (Story 19.9b)", () => {
  beforeEach(() => {
    recordSessionPaymentAction.mockReset();
    dismissFrontDeskAlert.mockReset().mockResolvedValue({ error: null });
    getSessionPaymentPanelContextAction.mockReset().mockResolvedValue({
      data: { planName: "Drop-in", planType: "pay_per_session", price: 2000, currency: "XAF", recordedByName: "Rita Desk" },
      error: null,
    });
  });

  it("shows the plan price read-only, Cash by default and who records it", async () => {
    await renderDialog();

    expect(screen.getByText("2,000 XAF")).toBeInTheDocument();
    expect(screen.getByText("Plan price — fixed")).toBeInTheDocument();
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Payment method" })).toHaveValue("cash");
    expect(screen.getByLabelText("Recorded by")).toHaveValue("Rita Desk");
  });

  it("omits Bank Transfer from the DOM for a receptionist and offers it to a manager", async () => {
    await renderDialog({ role: "receptionist" });
    expect(screen.queryByRole("option", { name: "Bank Transfer" })).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Manual Mobile Money" })).toBeInTheDocument();
  });

  it("offers Bank Transfer to a manager", async () => {
    await renderDialog({ role: "manager" });
    expect(screen.getByRole("option", { name: "Bank Transfer" })).toBeInTheDocument();
  });

  it("records the session with the chosen method and note, dismisses the alert and calls onRecorded", async () => {
    recordSessionPaymentAction.mockResolvedValue({ data: { sessionId: "s1" }, error: null });
    const user = userEvent.setup();
    const { onRecorded } = await renderDialog({ alertId: "alert-1" });

    await user.selectOptions(screen.getByRole("combobox", { name: "Payment method" }), "manual_momo");
    await user.type(screen.getByLabelText("Note (optional)"), "Paid by MoMo");
    await user.click(screen.getByRole("button", { name: "Record session payment" }));

    await waitFor(() =>
      expect(recordSessionPaymentAction).toHaveBeenCalledWith({
        memberId: MEMBER_ID,
        method: "manual_momo",
        reason: "Paid by MoMo",
      }),
    );
    await waitFor(() => expect(onRecorded).toHaveBeenCalled());
    expect(dismissFrontDeskAlert).toHaveBeenCalledWith("alert-1");
  });

  it("sends no reason when the note is empty", async () => {
    recordSessionPaymentAction.mockResolvedValue({ data: { sessionId: "s1" }, error: null });
    const user = userEvent.setup();
    await renderDialog();

    await user.click(screen.getByRole("button", { name: "Record session payment" }));

    await waitFor(() =>
      expect(recordSessionPaymentAction).toHaveBeenCalledWith({
        memberId: MEMBER_ID,
        method: "cash",
        reason: undefined,
      }),
    );
  });

  it("calls the RPC once on a double click while the request is in flight", async () => {
    let resolveCall: (value: unknown) => void = () => {};
    recordSessionPaymentAction.mockReturnValue(new Promise((resolve) => (resolveCall = resolve)));
    const user = userEvent.setup();
    await renderDialog();

    const button = screen.getByRole("button", { name: "Record session payment" });
    await user.dblClick(button);

    expect(recordSessionPaymentAction).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Recording…" })).toBeDisabled();
    resolveCall({ data: { sessionId: "s1" }, error: null });
  });

  it("keeps the panel open with the refusal's own message", async () => {
    recordSessionPaymentAction.mockResolvedValue({
      data: null,
      error: {
        code: "session_payment_already_in_progress",
        message: "A mobile money payment for this member is already in progress.",
      },
    });
    const user = userEvent.setup();
    const { onRecorded, onClose } = await renderDialog({ alertId: "alert-1" });

    await user.click(screen.getByRole("button", { name: "Record session payment" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "A mobile money payment for this member is already in progress.",
    );
    expect(onRecorded).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(dismissFrontDeskAlert).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Record session payment" })).toBeEnabled();
  });

  it("shows the permission copy when the server refuses the method", async () => {
    recordSessionPaymentAction.mockResolvedValue({
      data: null,
      error: { code: "permission_denied", message: "You do not have permission to record this payment method." },
    });
    const user = userEvent.setup();
    await renderDialog({ role: "manager" });

    await user.selectOptions(screen.getByRole("combobox", { name: "Payment method" }), "bank_transfer");
    await user.click(screen.getByRole("button", { name: "Record session payment" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("You do not have permission");
  });

  it("tabs Method, Note, Record, Cancel", async () => {
    const user = userEvent.setup();
    await renderDialog();

    const order: string[] = [];
    screen.getByRole("combobox", { name: "Payment method" }).focus();
    for (let i = 0; i < 4; i += 1) {
      const el = document.activeElement as HTMLElement;
      order.push(el.id || el.textContent || el.tagName);
      await user.tab();
    }
    expect(order).toEqual(["sessionPaymentMethod", "sessionPaymentNote", "Record session payment", "Cancel"]);
  });

  describe("focus", () => {
    function Harness({ removeTriggerOnRecorded }: { removeTriggerOnRecorded?: boolean }) {
      const [open, setOpen] = useState(false);
      const [triggerGone, setTriggerGone] = useState(false);
      return (
        <div>
          <h1 id="fallbackHeading" tabIndex={-1} aria-label="Fallback" />
          {!triggerGone && (
            <button type="button" onClick={() => setOpen(true)} aria-label="Open panel" />
          )}
          {open && (
            <RecordSessionPaymentDialog
              memberId={MEMBER_ID}
              memberName="Alice"
              role="receptionist"
              fallbackFocusId="fallbackHeading"
              onClose={() => setOpen(false)}
              onRecorded={() => {
                setOpen(false);
                if (removeTriggerOnRecorded) setTriggerGone(true);
              }}
            />
          )}
        </div>
      );
    }

    it("returns focus to the opening control when the panel is cancelled", async () => {
      const user = userEvent.setup();
      render(<Harness />);
      const opener = screen.getByRole("button", { name: "Open panel" });
      await user.click(opener);
      await waitFor(() => expect(screen.getByRole("button", { name: "Record session payment" })).toBeEnabled());

      await user.click(screen.getByRole("button", { name: "Cancel" }));

      await waitFor(() => expect(opener).toHaveFocus());
    });

    it("focuses the fallback element when the opening control is removed by the success", async () => {
      recordSessionPaymentAction.mockResolvedValue({ data: { sessionId: "s1" }, error: null });
      const user = userEvent.setup();
      render(<Harness removeTriggerOnRecorded />);
      await user.click(screen.getByRole("button", { name: "Open panel" }));
      await waitFor(() => expect(screen.getByRole("button", { name: "Record session payment" })).toBeEnabled());

      await user.click(screen.getByRole("button", { name: "Record session payment" }));

      await waitFor(() => expect(screen.getByRole("heading", { name: "Fallback" })).toHaveFocus());
    });
  });
});
