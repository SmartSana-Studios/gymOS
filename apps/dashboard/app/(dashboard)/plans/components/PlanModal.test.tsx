/**
 * Story 19.3: a plan with subscriptions renders its type read-only, and a
 * plan_type_locked refusal restores the plan's real type.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const editPlan = vi.fn();

vi.mock("../actions", () => ({
  createPlan: vi.fn(),
  editPlan: (...args: unknown[]) => editPlan(...args),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const PLAN = {
  id: "plan-1",
  name: "Gold",
  planType: "monthly",
  price: 15000,
  currency: "XAF",
  durationDays: 30,
  billingInterval: "monthly",
  annualDiscountPercent: null,
  hasSubscriptions: false,
} as const;

async function renderModal(plan: { hasSubscriptions: boolean }) {
  const { PlanModal } = await import("./PlanModal");
  render(
    <PlanModal
      open
      onClose={vi.fn()}
      onSaved={vi.fn()}
      editingPlan={{ ...PLAN, ...plan } as never}
    />,
  );
}

describe("PlanModal plan-type lock (Story 19.3)", () => {
  beforeEach(() => {
    editPlan.mockReset();
    HTMLDialogElement.prototype.showModal = vi.fn();
    HTMLDialogElement.prototype.close = vi.fn();
  });

  it("renders a read-only input, not a select, when the plan has subscriptions", async () => {
    await renderModal({ hasSubscriptions: true });

    const field = screen.getByLabelText("plans.modal.planType");
    expect(field.tagName).toBe("INPUT");
    expect(field).toHaveAttribute("aria-readonly", "true");
    expect(field).toHaveAttribute("aria-describedby", "planTypeLockedReason");
    expect(screen.getByText("plans.typeLocked.reason")).toBeInTheDocument();
  });

  it("renders a select when the plan has no subscriptions", async () => {
    await renderModal({ hasSubscriptions: false });
    expect(screen.getByLabelText("plans.modal.planType").tagName).toBe("SELECT");
  });

  it("locks the field and restores the real type after a plan_type_locked refusal", async () => {
    editPlan.mockResolvedValue({
      data: null,
      error: { code: "plan_type_locked", message: "plans.typeLocked.reason" },
    });
    const user = userEvent.setup();
    await renderModal({ hasSubscriptions: false });

    await user.selectOptions(screen.getByLabelText("plans.modal.planType"), "pay_per_session");
    await user.click(screen.getByRole("button", { name: "plans.modal.saveChanges", hidden: true }));

    await waitFor(() => expect(editPlan).toHaveBeenCalledTimes(1));
    expect(editPlan.mock.calls[0][1]).toMatchObject({ planType: "pay_per_session" });

    await waitFor(() => {
      const field = screen.getByLabelText("plans.modal.planType");
      expect(field.tagName).toBe("INPUT");
      expect(field).toHaveValue("plans.types.monthly");
    });
    expect(screen.getAllByText("plans.typeLocked.reason")).toHaveLength(1);
    expect(screen.getByLabelText("plans.modal.durationDays")).toHaveValue(30);
  });
});
