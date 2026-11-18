/**
 * Story 27.4 (FR-240, UX AD-23): the Plans list says what an annual plan costs. "XAF 250,000 · 365 days · Paid once" in place of the old
 * "/ annual" suffix, a muted "Includes 15% annual discount" line when a discount is set, French wording, and the monthly and
 * Pay-per-session rows exactly as shipped.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { realT } from "@/test-utils/realT";

let language: "en" | "fr" = "en";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: realT(language), i18n: { language } }) }));
vi.mock("../actions", () => ({ deletePlan: vi.fn(), createPlan: vi.fn(), editPlan: vi.fn() }));
vi.mock("./PlanModal", () => ({ PlanModal: () => null }));

const base = { currency: "XAF", hasSubscriptions: false };
const PLANS = [
  { ...base, id: "a", name: "ANNUAL", planType: "monthly", price: 250000, durationDays: 365, billingInterval: "annual", annualDiscountPercent: 15 },
  { ...base, id: "a0", name: "ANNUAL ZERO", planType: "monthly", price: 120000, durationDays: 365, billingInterval: "annual", annualDiscountPercent: 0 },
  { ...base, id: "m", name: "MONTHLY", planType: "monthly", price: 25000, durationDays: 30, billingInterval: "monthly", annualDiscountPercent: null },
  { ...base, id: "p", name: "DROP-IN", planType: "pay_per_session", price: 2000, durationDays: null, billingInterval: "monthly", annualDiscountPercent: null },
];

async function renderPlans() {
  const { PlansPageClient } = await import("./PlansPageClient");
  return render(<PlansPageClient initialPlans={PLANS as never} />);
}
const flat = (s: string | null | undefined) => (s ?? "").replace(/[  ]/g, " ");

describe("Plans list annual wording (Story 27.4)", () => {
  it("EN: annual row, discount line, monthly and Pay-per-session rows", async () => {
    language = "en";
    await renderPlans();
    expect(screen.getByText("XAF 250,000 · 365 days · Paid once")).toBeInTheDocument();
    expect(screen.getByText("Includes 15% annual discount")).toBeInTheDocument();
    expect(screen.getByText("XAF 25,000 / monthly · 30 days")).toBeInTheDocument();
    expect(screen.getByText("XAF 2,000 / session · No fixed duration — billed per visit")).toBeInTheDocument();
    expect(screen.queryByText(/annual\)/)).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\/ annual/);
  });

  it("a 0% discount shows no discount line", async () => {
    language = "en";
    await renderPlans();
    expect(screen.getAllByText(/annual discount/)).toHaveLength(1);
  });

  it("FR: « 250 000 XAF · 365 jours · Payé en une fois » and « Dont 15 % de remise annuelle »", async () => {
    language = "fr";
    const { container } = await renderPlans();
    const text = flat(container.textContent);
    expect(text).toContain("250 000 XAF · 365 jours · Payé en une fois");
    expect(text).toContain("Dont 15 % de remise annuelle");
  });
});
