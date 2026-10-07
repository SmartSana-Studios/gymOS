/**
 * The pending-payments queue paginates client-side: 10 rows per page by default,
 * with a rows-per-page selector (5/10/25/50).
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));
vi.mock("../actions", () => ({}));
vi.mock("./RecordPaymentModal", () => ({ RecordPaymentModal: () => null }));
vi.mock("./RecordRefundModal", () => ({ RecordRefundModal: () => null }));
vi.mock("./VerifyPaymentConfirmDialog", () => ({ VerifyPaymentConfirmDialog: () => null }));
vi.mock("./FlagPaymentDialog", () => ({ FlagPaymentDialog: () => null }));

const rows = Array.from({ length: 12 }, (_, i) => ({
  id: `p${i}`,
  memberId: `m${i}`,
  memberName: `Member ${i}`,
  memberPhone: null,
  amount: 5000,
  method: "cash",
  reason: "x",
  purpose: "subscription",
  createdAt: "2026-10-01T00:00:00Z",
  actorName: "Staff",
}));

describe("PaymentsPageClient pagination", () => {
  it("renders one page of the queue and the selector changes the page size", async () => {
    const { PaymentsPageClient } = await import("./PaymentsPageClient");
    render(<PaymentsPageClient pendingPayments={rows} discrepancies={[]} recordedByName="Staff" role="owner" />);

    // header row + 10 body rows
    expect(screen.getAllByRole("row")).toHaveLength(11);
    expect(screen.queryByText("Member 10")).toBeNull();

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "5" } });
    expect(screen.getAllByRole("row")).toHaveLength(6);

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "25" } });
    expect(screen.getAllByRole("row")).toHaveLength(13);
    expect(screen.getByText("Member 11")).toBeInTheDocument();
  });
});
