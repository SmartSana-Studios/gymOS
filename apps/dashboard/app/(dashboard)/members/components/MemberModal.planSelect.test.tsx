/**
 * Story 27.4 (UX AD-23, AD-05): the member form's plan select (create, step 2, a gym without a registration fee) lists each plan as
 * "{name} · {summary line}", an annual plan with "Paid once".
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { realT } from "@/test-utils/realT";

vi.mock("../actions", () => ({
  createMember: vi.fn(),
  editMember: vi.fn(),
  assignCoach: vi.fn(),
  getCoachAssignments: vi.fn(async () => ({ data: null, error: null })),
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: realT("en"), i18n: { language: "en" } }) }));
vi.mock("@/components/ui/phone-input", () => ({
  PhoneInput: ({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) => (
    <input id={id} value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));

const PLANS = [
  { id: "a", name: "ANNUAL", planType: "monthly", price: 250000, durationDays: 365, billingInterval: "annual" },
  { id: "m", name: "MONTHLY", planType: "monthly", price: 25000, durationDays: 30, billingInterval: "monthly" },
  { id: "p", name: "DROP-IN", planType: "pay_per_session", price: 2000, durationDays: null, billingInterval: "monthly" },
];

describe("MemberModal plan select (Story 27.4)", () => {
  it("lists every plan as its summary line", async () => {
    const { MemberModal } = await import("./MemberModal");
    render(<MemberModal open readOnly={false} editingMember={null} plans={PLANS as never} coaches={[]} registrationFee={0} onClose={vi.fn()} onSaved={vi.fn()} />);
    const user = userEvent.setup();
    await user.type(document.getElementById("memberName") as HTMLInputElement, "Alice Mballa");
    const phone = document.getElementById("memberPhone") as HTMLInputElement;
    await user.clear(phone);
    await user.type(phone, "+237680811041");
    await user.click(screen.getByRole("button", { name: "Next" }));
    const select = await screen.findByLabelText("Plan *");
    expect(Array.from((select as HTMLSelectElement).options).map((o) => o.textContent)).toEqual([
      "Select a plan",
      "ANNUAL · 250,000 XAF · 365 days · Paid once",
      "MONTHLY · 25,000 XAF · 30 days",
      "DROP-IN · 2,000 XAF / session",
    ]);
  });
});
