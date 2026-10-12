/**
 * Story 19.9c: the All Payments ledger table -- one case per matrix row that
 * the client owns.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

const push = vi.fn();
let search = "";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
  usePathname: () => "/payments",
  useSearchParams: () => new URLSearchParams(search),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));
const exportAction = vi.fn();
vi.mock("../actions", () => ({ exportPaymentsCsvAction: (...a: unknown[]) => exportAction(...a) }));

import { PaymentsLedger } from "./PaymentsLedger";

function row(over: Record<string, unknown>) {
  return {
    id: "r",
    memberId: "m",
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
    ...over,
  };
}

function ledger(rows: ReturnType<typeof row>[]) {
  return { rows, total: rows.length, page: 1, pageSize: 50 };
}

describe("PaymentsLedger", () => {
  beforeEach(() => {
    push.mockReset();
    exportAction.mockReset();
    search = "";
  });

  it("shows a desk session as Session, Verified, with the staff actor", () => {
    render(<PaymentsLedger ledger={ledger([row({})])} hasError={false} purpose="" memberId="" />);
    const r = screen.getByText("Gina").closest("tr")!;
    expect(r).toHaveTextContent("payments.purposes.session");
    expect(r).toHaveTextContent("payments.status.verified");
    expect(r).toHaveTextContent("Staff Sam");
  });

  it("shows Verified plus Confirmed late for a late Tara session, and Tara as actor", () => {
    render(
      <PaymentsLedger
        ledger={ledger([row({ flaggedReason: "late_confirmation", actorName: null, method: "mobile_money" })])}
        hasError={false}
        purpose=""
        memberId=""
      />,
    );
    const r = screen.getByText("Gina").closest("tr")!;
    expect(r).toHaveTextContent("payments.status.verified");
    expect(r).toHaveTextContent("payments.flaggedReasons.lateConfirmation");
    expect(r).toHaveTextContent("payments.ledger.actorTara");
  });

  it("keeps a wrong-account payment Flagged with its tag, and tags voided rows", () => {
    render(
      <PaymentsLedger
        ledger={ledger([
          row({ id: "a", memberName: "Wanda", status: "flagged", flaggedReason: "wrong_account" }),
          row({ id: "b", memberName: "Vic", voidedAt: "2026-10-11T09:00:00Z" }),
        ])}
        hasError={false}
        purpose=""
        memberId=""
      />,
    );
    expect(screen.getByText("Wanda").closest("tr")).toHaveTextContent("payments.status.flagged");
    expect(screen.getByText("Wanda").closest("tr")).toHaveTextContent("payments.discrepancies.types.wrongAccountSettlement");
    expect(screen.getByText("Vic").closest("tr")).toHaveTextContent("payments.ledger.voided");
  });

  it("shows the filtered empty state with Clear filters", () => {
    search = "purpose=session&memberId=m";
    render(<PaymentsLedger ledger={ledger([])} hasError={false} purpose="session" memberId="m" />);
    expect(screen.getByText("payments.ledger.emptyFiltered")).toBeInTheDocument();
    fireEvent.click(screen.getByText("payments.ledger.clearFilters"));
    expect(push).toHaveBeenCalledWith("/payments?page=1");
  });

  it("shows the plain empty state without a filter", () => {
    render(<PaymentsLedger ledger={ledger([])} hasError={false} purpose="" memberId="" />);
    expect(screen.getByText("payments.ledger.empty")).toBeInTheDocument();
  });

  it("shows a load error in place of the table", () => {
    render(<PaymentsLedger ledger={null} hasError purpose="" memberId="" />);
    expect(screen.getByText("payments.ledger.loadError")).toBeInTheDocument();
  });

  it("changing the purpose filter pushes the URL and resets the page", () => {
    search = "memberId=m&page=3";
    render(<PaymentsLedger ledger={ledger([row({})])} hasError={false} purpose="" memberId="m" />);
    fireEvent.change(screen.getByLabelText("payments.purposeFilter.label"), { target: { value: "session" } });
    expect(push).toHaveBeenCalledWith("/payments?memberId=m&page=1&purpose=session");
  });

  it("surfaces the export_too_large message and downloads nothing", async () => {
    exportAction.mockResolvedValue({ data: null, error: { code: "export_too_large", message: "too big" } });
    render(<PaymentsLedger ledger={ledger([row({})])} hasError={false} purpose="session" memberId="" />);
    fireEvent.click(screen.getByText("payments.export.button"));
    expect(await screen.findByText("too big")).toBeInTheDocument();
    expect(exportAction).toHaveBeenCalledWith({ purpose: "session", memberId: undefined });
  });

  it("passes the member filter to the export action", async () => {
    exportAction.mockResolvedValue({ data: null, error: { code: "x", message: "nope" } });
    render(<PaymentsLedger ledger={ledger([row({})])} hasError={false} purpose="session" memberId="m" />);
    fireEvent.click(screen.getByText("payments.export.button"));
    await screen.findByText("nope");
    expect(exportAction).toHaveBeenCalledWith({ purpose: "session", memberId: "m" });
  });

  it("downloads payments.csv when the export succeeds", async () => {
    exportAction.mockResolvedValue({ data: "a,b", error: null });
    const createUrl = vi.fn(() => "blob:x");
    const revoke = vi.fn();
    Object.assign(URL, { createObjectURL: createUrl, revokeObjectURL: revoke });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    render(<PaymentsLedger ledger={ledger([row({})])} hasError={false} purpose="" memberId="" />);
    fireEvent.click(screen.getByText("payments.export.button"));
    await vi.waitFor(() => expect(click).toHaveBeenCalled());
    expect(createUrl).toHaveBeenCalledTimes(1);
    expect(revoke).toHaveBeenCalledWith("blob:x");
    click.mockRestore();
  });
});
