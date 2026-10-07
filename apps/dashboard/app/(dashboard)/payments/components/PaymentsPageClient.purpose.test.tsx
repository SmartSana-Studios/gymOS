/**
 * Story 18.6: the Payments page names a registration fee payment wherever it
 * renders a payment's purpose (the pending queue and the discrepancies table);
 * an ordinary subscription payment keeps its row unchanged.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));
vi.mock("../actions", () => ({}));
vi.mock("./RecordPaymentModal", () => ({ RecordPaymentModal: () => null }));
vi.mock("./RecordRefundModal", () => ({ RecordRefundModal: () => null }));
vi.mock("./VerifyPaymentConfirmDialog", () => ({ VerifyPaymentConfirmDialog: () => null }));
vi.mock("./FlagPaymentDialog", () => ({ FlagPaymentDialog: () => null }));

function pending(id: string, purpose: string, memberName: string) {
  return {
    id,
    memberId: `member-${id}`,
    memberName,
    memberPhone: null,
    amount: 5000,
    method: "cash",
    reason: "x",
    purpose,
    createdAt: "2026-10-01T00:00:00Z",
    actorName: "Staff",
  };
}

describe("PaymentsPageClient purpose label (Story 18.6)", () => {
  it("labels a registration fee in the pending queue and the discrepancies table, not a subscription", async () => {
    const { PaymentsPageClient } = await import("./PaymentsPageClient");
    render(
      <PaymentsPageClient
        pendingPayments={[pending("a", "registration_fee", "Fee Fiona"), pending("b", "subscription", "Sub Sam")]}
        discrepancies={[
          {
            id: "d1",
            discrepancyType: "stale_processing",
            memberId: "member-d",
            memberName: "Stale Stan",
            amount: 5000,
            currency: "XAF",
            purpose: "registration_fee",
            details: {},
            detectedAt: "2026-10-01T00:00:00Z",
          },
        ]}
        recordedByName="Staff"
        role="owner"
      />,
    );

    const rows = screen.getAllByRole("row");
    const fee = rows.find((r) => r.textContent?.includes("Fee Fiona"));
    const sub = rows.find((r) => r.textContent?.includes("Sub Sam"));
    const stale = rows.find((r) => r.textContent?.includes("Stale Stan"));
    expect(fee).toHaveTextContent("payments.purposes.registrationFee");
    expect(sub).not.toHaveTextContent("payments.purposes");
    expect(stale).toHaveTextContent("payments.purposes.registrationFee");
  });
});
