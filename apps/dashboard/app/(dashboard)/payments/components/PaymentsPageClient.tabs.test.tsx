/**
 * The Payments page keeps the three payment tables together in the Payments tab and puts the refund
 * history in its own tab; the selected tab lives in the URL and the other parameters are kept.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const replace = vi.fn();
let search = "";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), replace }),
  usePathname: () => "/payments",
  useSearchParams: () => new URLSearchParams(search),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));
vi.mock("../actions", () => ({}));
vi.mock("./RecordPaymentModal", () => ({ RecordPaymentModal: () => null }));
vi.mock("./RecordRefundModal", () => ({ RecordRefundModal: () => null }));
vi.mock("./VerifyPaymentConfirmDialog", () => ({ VerifyPaymentConfirmDialog: () => null }));
vi.mock("./FlagPaymentDialog", () => ({ FlagPaymentDialog: () => null }));
vi.mock("./PaymentsLedger", () => ({ PaymentsLedger: () => <div>LEDGER-TABLE</div> }));
vi.mock("./RefundHistory", () => ({ RefundHistory: () => <div>REFUND-TABLE</div> }));

import { PaymentsPageClient } from "./PaymentsPageClient";

function renderPage() {
  render(
    <PaymentsPageClient
      pendingPayments={[]}
      discrepancies={[]}
      recordedByName="Staff"
      role="owner"
      ledger={{} as never}
      refunds={{} as never}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  search = "";
});

describe("PaymentsPageClient tabs", () => {
  it("opens on Payments with the ledger and hides the refund history", () => {
    renderPage();
    expect(screen.getByText("LEDGER-TABLE")).toBeInTheDocument();
    expect(screen.queryByText("REFUND-TABLE")).toBeNull();
  });

  it("opens on the tab named in the URL", () => {
    search = "tab=refunds";
    renderPage();
    expect(screen.getByText("REFUND-TABLE")).toBeInTheDocument();
    expect(screen.queryByText("LEDGER-TABLE")).toBeNull();
  });

  it("writes the selected tab to the URL and keeps the ledger filters", async () => {
    search = "purpose=session&page=2";
    renderPage();
    await userEvent.setup().click(screen.getByRole("tab", { name: "payments.tabs.refunds" }));
    expect(replace).toHaveBeenCalledWith("/payments?purpose=session&page=2&tab=refunds", { scroll: false });
  });
});
