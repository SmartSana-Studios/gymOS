/**
 * Story 27.4 (UX AD-23): the renewal panel's plan name area is the plan summary line, so an annual plan reads "Paid once". A preview
 * without the plan's type and duration (an older shape) falls back to the plan name alone.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { realT } from "@/test-utils/realT";

const getRenewalPreviewAction = vi.fn();

vi.mock("@/lib/realtime/paymentStatus", () => ({ subscribeToPaymentStatus: vi.fn(), fetchPaymentStatus: vi.fn(async () => null) }));
vi.mock("@/lib/realtime/frontDeskAlerts", () => ({ dismissFrontDeskAlert: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ removeChannel: vi.fn() }) }));
vi.mock("@/app/(dashboard)/subscriptions/actions", () => ({
  getRenewalPreviewAction: (...args: unknown[]) => getRenewalPreviewAction(...args),
  confirmRenewalAction: vi.fn(),
}));
vi.mock("@/app/(dashboard)/payments/actions", () => ({
  initiatePaymentAction: vi.fn(),
  getPendingMobileMoneyPaymentAction: vi.fn(async () => ({ data: null, error: null })),
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: realT("en"), i18n: { language: "en" } }) }));

async function renderModal() {
  const { RenewalModal } = await import("./RenewalModal");
  render(<RenewalModal memberId="member-1" memberName="Alice" mobileMoneyEnabled={false} onClose={vi.fn()} onRenewed={vi.fn()} />);
}

describe("RenewalModal plan name area (Story 27.4)", () => {
  it("an annual preview reads 'Paid once'", async () => {
    getRenewalPreviewAction.mockResolvedValue({
      data: { planName: "ANNUAL", price: 250000, currency: "XAF", memberPhone: null, planType: "monthly", durationDays: 365, billingInterval: "annual" },
      error: null,
    });
    await renderModal();
    expect(await screen.findByText("ANNUAL (250,000 XAF · 365 days · Paid once)")).toBeInTheDocument();
  });

  it("a monthly preview has no 'Paid once'", async () => {
    getRenewalPreviewAction.mockResolvedValue({
      data: { planName: "MONTHLY", price: 25000, currency: "XAF", memberPhone: null, planType: "monthly", durationDays: 30, billingInterval: "monthly" },
      error: null,
    });
    await renderModal();
    expect(await screen.findByText("MONTHLY (25,000 XAF · 30 days)")).toBeInTheDocument();
  });

  it("a preview without type and duration shows the plan name alone", async () => {
    getRenewalPreviewAction.mockResolvedValue({ data: { planName: "Monthly", price: 15000, currency: "XAF", memberPhone: null }, error: null });
    await renderModal();
    expect(await screen.findByText("Monthly")).toBeInTheDocument();
  });
});
