/**
 * Story 19.9c: PaymentsPageClient hands the ledger props to PaymentsLedger --
 * the chain the member modal Sessions link (?memberId=&purpose=session) relies on.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/payments",
  useSearchParams: () => new URLSearchParams(""),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));
vi.mock("../actions", () => ({ exportPaymentsCsvAction: vi.fn() }));
vi.mock("./RecordPaymentModal", () => ({ RecordPaymentModal: () => null }));
vi.mock("./RecordRefundModal", () => ({ RecordRefundModal: () => null }));
vi.mock("./VerifyPaymentConfirmDialog", () => ({ VerifyPaymentConfirmDialog: () => null }));
vi.mock("./FlagPaymentDialog", () => ({ FlagPaymentDialog: () => null }));

const base = { pendingPayments: [], discrepancies: [], recordedByName: "Staff", role: "owner" as const };

const ledger = {
  rows: [
    {
      id: "p1",
      memberId: "m1",
      memberName: "Gina",
      amount: 2000,
      currency: "XAF",
      method: "cash",
      purpose: "session",
      status: "verified",
      flaggedReason: null,
      voidedAt: null,
      note: null,
      createdAt: "2026-10-11T08:00:00Z",
      actorName: "Staff Sam",
    },
  ],
  total: 1,
  page: 1,
  pageSize: 50,
};

describe("PaymentsPageClient ledger wiring (Story 19.9c)", () => {
  it("renders the ledger with the filter value and rows it was given", async () => {
    const { PaymentsPageClient } = await import("./PaymentsPageClient");
    render(<PaymentsPageClient {...base} ledger={ledger} ledgerPurpose="session" ledgerMemberId="m1" />);
    expect(screen.getByLabelText("payments.purposeFilter.label")).toHaveValue("session");
    expect(screen.getByText("Gina")).toBeInTheDocument();
    expect(screen.getByText("payments.ledger.clearFilters")).toBeInTheDocument();
  });

  it("shows the load error when the ledger read failed", async () => {
    const { PaymentsPageClient } = await import("./PaymentsPageClient");
    render(<PaymentsPageClient {...base} ledger={null} ledgerError />);
    expect(screen.getByText("payments.ledger.loadError")).toBeInTheDocument();
  });

  it("renders no ledger section when neither prop is given", async () => {
    const { PaymentsPageClient } = await import("./PaymentsPageClient");
    render(<PaymentsPageClient {...base} />);
    expect(screen.queryByText("payments.ledger.title")).not.toBeInTheDocument();
  });
});
