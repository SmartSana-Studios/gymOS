/**
 * Story 18.6: the Assign plan dialog calls assignInitialPlan (Story 18.5) with
 * the chosen plan and start date, surfaces its refusals (registration_fee_due,
 * member_already_has_subscription), and keeps its submit disabled while pending.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const assignInitialPlan = vi.fn();

vi.mock("../actions", () => ({
  assignInitialPlan: (...args: unknown[]) => assignInitialPlan(...args),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string, vars?: Record<string, unknown>) => (vars?.name ? `${key}|${vars.name}` : key) }),
}));

const MEMBER_FIXTURE = { id: "3fa85f64-5717-4562-b3fc-2c963f66afa6", name: "Alice" };
const MEMBER = MEMBER_FIXTURE as never;
const PLANS = [
  { id: "plan-1", name: "Monthly" },
  { id: "plan-2", name: "Quarterly" },
] as never;

async function renderDialog() {
  const { AssignInitialPlanDialog } = await import("./AssignInitialPlanDialog");
  const onDone = vi.fn();
  render(<AssignInitialPlanDialog member={MEMBER} plans={PLANS} onClose={vi.fn()} onDone={onDone} />);
  return { onDone };
}

describe("AssignInitialPlanDialog (Story 18.6)", () => {
  beforeEach(() => {
    assignInitialPlan.mockReset();
  });

  it("keeps the submit disabled until a plan is chosen", async () => {
    const user = userEvent.setup();
    await renderDialog();

    const submit = screen.getByRole("button", { name: "members.assignPlan.confirmButton" });
    expect(submit).toBeDisabled();
    await user.selectOptions(screen.getByLabelText("members.assignPlan.plan"), "plan-2");
    expect(submit).toBeEnabled();
  });

  it("assigns the chosen plan with the start date and calls onDone", async () => {
    assignInitialPlan.mockResolvedValue({ data: { id: "sub-1" }, error: null });
    const user = userEvent.setup();
    const { onDone } = await renderDialog();

    await user.selectOptions(screen.getByLabelText("members.assignPlan.plan"), "plan-2");
    const startDate = screen.getByLabelText("members.assignPlan.startDate");
    await user.clear(startDate);
    await user.type(startDate, "2026-10-15");
    await user.click(screen.getByRole("button", { name: "members.assignPlan.confirmButton" }));

    await waitFor(() => expect(assignInitialPlan).toHaveBeenCalledWith(MEMBER_FIXTURE.id, "plan-2", "2026-10-15"));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith());
  });

  it.each([
    ["registration_fee_due", "The registration fee has not been settled."],
    ["member_already_has_subscription", "This member already has a subscription."],
  ])("shows the %s refusal and stays open", async (code, message) => {
    assignInitialPlan.mockResolvedValue({ data: null, error: { code, message } });
    const user = userEvent.setup();
    const { onDone } = await renderDialog();

    await user.selectOptions(screen.getByLabelText("members.assignPlan.plan"), "plan-1");
    await user.click(screen.getByRole("button", { name: "members.assignPlan.confirmButton" }));

    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(onDone).not.toHaveBeenCalled();
  });

  it("closes with the warning when only the audit write failed", async () => {
    assignInitialPlan.mockResolvedValue({
      data: { id: "sub-1" },
      error: { code: "audit_log_failed", message: "Plan assigned, audit failed." },
    });
    const user = userEvent.setup();
    const { onDone } = await renderDialog();

    await user.selectOptions(screen.getByLabelText("members.assignPlan.plan"), "plan-1");
    await user.click(screen.getByRole("button", { name: "members.assignPlan.confirmButton" }));

    await waitFor(() => expect(onDone).toHaveBeenCalledWith("Plan assigned, audit failed."));
  });

  it("disables the submit while the call is pending and sends one request", async () => {
    let resolveCall: (value: unknown) => void = () => {};
    assignInitialPlan.mockReturnValue(new Promise((resolve) => (resolveCall = resolve)));
    const user = userEvent.setup();
    await renderDialog();

    await user.selectOptions(screen.getByLabelText("members.assignPlan.plan"), "plan-1");
    await user.click(screen.getByRole("button", { name: "members.assignPlan.confirmButton" }));

    const pending = await screen.findByRole("button", { name: "members.assignPlan.assigning" });
    expect(pending).toBeDisabled();
    await user.click(pending);
    expect(assignInitialPlan).toHaveBeenCalledTimes(1);
    resolveCall({ data: { id: "sub-1" }, error: null });
  });
});
