/* eslint-disable i18next/no-literal-string -- test doubles render fixed marker text; no user-facing copy */
/**
 * Story 19.9b: a session refund's success toast names the resolved outcome;
 * an audit warning wins over it.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));
vi.mock("../actions", () => ({}));
vi.mock("./RecordPaymentModal", () => ({ RecordPaymentModal: () => null }));
vi.mock("./VerifyPaymentConfirmDialog", () => ({ VerifyPaymentConfirmDialog: () => null }));
vi.mock("./FlagPaymentDialog", () => ({ FlagPaymentDialog: () => null }));
vi.mock("./RecordRefundModal", () => ({
  RecordRefundModal: ({ onSaved }: { onSaved: (w?: string, o?: "cancelled" | "used" | "kept") => void }) => (
    <div>
      <button type="button" onClick={() => onSaved(undefined, "cancelled")}>
        save-outcome
      </button>
      <button type="button" onClick={() => onSaved("audit failed", "cancelled")}>
        save-warning
      </button>
    </div>
  ),
}));

async function open() {
  const { PaymentsPageClient } = await import("./PaymentsPageClient");
  const user = userEvent.setup();
  render(<PaymentsPageClient pendingPayments={[]} discrepancies={[]} recordedByName="Rita" role="owner" />);
  await user.click(screen.getByRole("button", { name: "payments.recordRefundButton" }));
  return user;
}

describe("PaymentsPageClient refund toast (Story 19.9b)", () => {
  it("shows the cancelled outcome toast", async () => {
    const user = await open();
    await user.click(screen.getByRole("button", { name: "save-outcome" }));
    expect(screen.getByRole("status")).toHaveTextContent("payments.refundModal.outcome.cancelled");
  });

  it("shows the warning instead of the outcome", async () => {
    const user = await open();
    await user.click(screen.getByRole("button", { name: "save-warning" }));
    expect(screen.getByRole("status")).toHaveTextContent("audit failed");
    expect(screen.getByRole("status")).not.toHaveTextContent("outcome");
  });
});
