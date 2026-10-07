/**
 * Story 18.6: the waive dialog says the member is settled without a payment and
 * that it cannot be undone, requires a 10-200 character reason, and keeps its
 * submit disabled while the call is pending.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const waiveRegistrationFeeAction = vi.fn();

vi.mock("@/app/(dashboard)/payments/actions", () => ({
  waiveRegistrationFeeAction: (...args: unknown[]) => waiveRegistrationFeeAction(...args),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string, vars?: Record<string, unknown>) => (vars?.name ? `${key}|${vars.name}` : key) }),
}));

const MEMBER_FIXTURE = { id: "3fa85f64-5717-4562-b3fc-2c963f66afa6", name: "Alice" };
const MEMBER = MEMBER_FIXTURE as never;

async function renderDialog() {
  const { WaiveRegistrationFeeDialog } = await import("./WaiveRegistrationFeeDialog");
  const onDone = vi.fn();
  render(<WaiveRegistrationFeeDialog member={MEMBER} onClose={vi.fn()} onDone={onDone} />);
  return { onDone };
}

describe("WaiveRegistrationFeeDialog (Story 18.6)", () => {
  beforeEach(() => {
    waiveRegistrationFeeAction.mockReset();
  });

  it("states that the member is settled without a payment and that it cannot be undone", async () => {
    await renderDialog();

    // The copy itself is pinned in the locale files; the dialog renders the key.
    expect(screen.getByText("members.feeWaive.body|Alice")).toBeInTheDocument();
    const en = (await import("@/locales/en.json")).default as { members: { feeWaive: { body: string } } };
    expect(en.members.feeWaive.body).toMatch(/without a payment/i);
    expect(en.members.feeWaive.body).toMatch(/cannot be undone/i);
  });

  it("keeps the confirm disabled until the reason has 10 characters", async () => {
    const user = userEvent.setup();
    await renderDialog();

    const confirm = screen.getByRole("button", { name: "members.feeWaive.confirmButton|Alice" });
    expect(confirm).toBeDisabled();
    await user.type(screen.getByLabelText("members.feeWaive.reason"), "123456789");
    expect(confirm).toBeDisabled();
    await user.type(screen.getByLabelText("members.feeWaive.reason"), "0");
    expect(confirm).toBeEnabled();
  });

  it("waives with the member and reason, then calls onDone", async () => {
    waiveRegistrationFeeAction.mockResolvedValue({ error: null });
    const user = userEvent.setup();
    const { onDone } = await renderDialog();

    await user.type(screen.getByLabelText("members.feeWaive.reason"), "Friend of the owner");
    await user.click(screen.getByRole("button", { name: "members.feeWaive.confirmButton|Alice" }));

    await waitFor(() =>
      expect(waiveRegistrationFeeAction).toHaveBeenCalledWith({ memberId: MEMBER_FIXTURE.id, reason: "Friend of the owner" }),
    );
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it("shows the mapped error and stays open when the waive fails", async () => {
    waiveRegistrationFeeAction.mockResolvedValue({
      error: { code: "registration_fee_not_due", message: "No registration fee outstanding." },
    });
    const user = userEvent.setup();
    const { onDone } = await renderDialog();

    await user.type(screen.getByLabelText("members.feeWaive.reason"), "Friend of the owner");
    await user.click(screen.getByRole("button", { name: "members.feeWaive.confirmButton|Alice" }));

    expect(await screen.findByText("No registration fee outstanding.")).toBeInTheDocument();
    expect(onDone).not.toHaveBeenCalled();
  });

  it("disables the submit while pending and sends one request", async () => {
    let resolveCall: (value: unknown) => void = () => {};
    waiveRegistrationFeeAction.mockReturnValue(new Promise((resolve) => (resolveCall = resolve)));
    const user = userEvent.setup();
    await renderDialog();

    await user.type(screen.getByLabelText("members.feeWaive.reason"), "Friend of the owner");
    await user.click(screen.getByRole("button", { name: "members.feeWaive.confirmButton|Alice" }));

    const pending = await screen.findByRole("button", { name: "members.feeWaive.waiving" });
    expect(pending).toBeDisabled();
    await user.click(pending);
    expect(waiveRegistrationFeeAction).toHaveBeenCalledTimes(1);
    resolveCall({ error: null });
  });
});
