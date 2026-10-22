/** Story 23-6c: the page passes isSupport to the refund dialog, so only a support session sees the authenticator code field. */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));
vi.mock("../actions", () => ({
  listRefundEligiblePaymentsAction: vi.fn(async () => ({ data: [], error: null })),
  recordRefundAction: vi.fn(),
  searchMembersForPaymentAction: vi.fn(async () => ({ data: [], error: null })),
}));
vi.mock("./RecordPaymentModal", () => ({ RecordPaymentModal: () => null }));
vi.mock("./VerifyPaymentConfirmDialog", () => ({ VerifyPaymentConfirmDialog: () => null }));
vi.mock("./FlagPaymentDialog", () => ({ FlagPaymentDialog: () => null }));

async function openRefund(role: "support" | "owner") {
  const { PaymentsPageClient } = await import("./PaymentsPageClient");
  render(<PaymentsPageClient pendingPayments={[]} discrepancies={[]} recordedByName="Rita" role={role} />);
  await userEvent.setup().click(screen.getByRole("button", { name: "payments.recordRefundButton" }));
}

describe("PaymentsPageClient refund dialog (Story 23-6c)", () => {
  it("support: the refund dialog shows the code field", async () => {
    await openRefund("support");
    expect(screen.getByLabelText("supportStepUp.codeLabel")).toBeInTheDocument();
  });

  it("a staff role: no code field", async () => {
    await openRefund("owner");
    expect(screen.queryByLabelText("supportStepUp.codeLabel")).toBeNull();
  });
});
