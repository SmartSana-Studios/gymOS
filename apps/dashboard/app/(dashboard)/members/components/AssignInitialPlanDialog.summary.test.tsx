/**
 * Story 27.4 (UX AD-23, AD-05): the assign-plan select shows each plan as "{name} · {summary line}", an annual plan with "Paid once".
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { realT } from "@/test-utils/realT";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: realT("en"), i18n: { language: "en" } }) }));
vi.mock("../actions", () => ({ assignInitialPlan: vi.fn() }));

const PLANS = [
  { id: "a", name: "ANNUAL", planType: "monthly", price: 250000, durationDays: 365, billingInterval: "annual" },
  { id: "m", name: "MONTHLY", planType: "monthly", price: 25000, durationDays: 30, billingInterval: "monthly" },
  { id: "p", name: "DROP-IN", planType: "pay_per_session", price: 2000, durationDays: null, billingInterval: "monthly" },
];

describe("AssignInitialPlanDialog plan select (Story 27.4)", () => {
  it("lists every plan as its summary line", async () => {
    const { AssignInitialPlanDialog } = await import("./AssignInitialPlanDialog");
    render(<AssignInitialPlanDialog member={{ id: "m-1", name: "Alice" } as never} plans={PLANS as never} onClose={vi.fn()} onDone={vi.fn()} />);
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Select a plan",
      "ANNUAL · 250,000 XAF · 365 days · Paid once",
      "MONTHLY · 25,000 XAF · 30 days",
      "DROP-IN · 2,000 XAF / session",
    ]);
  });
});
