/**
 * Story 18.6: the void dialog reads the fee payment first. A manual fee can be
 * voided with a reason ("not a refund"); a Tara fee shows the hint and no
 * submit; a member with no fee payment has nothing to void.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const getMemberRegistrationFeeStateAction = vi.fn();
const voidRegistrationFeeAction = vi.fn();

vi.mock("@/app/(dashboard)/payments/actions", () => ({
  getMemberRegistrationFeeStateAction: (...args: unknown[]) => getMemberRegistrationFeeStateAction(...args),
  voidRegistrationFeeAction: (...args: unknown[]) => voidRegistrationFeeAction(...args),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) => (vars?.name ? `${key}|${vars.name}` : key),
    i18n: { language: "en" },
  }),
}));

const MEMBER = { id: "3fa85f64-5717-4562-b3fc-2c963f66afa6", name: "Alice" } as never;
const PAYMENT_ID = "4fa85f64-5717-4562-b3fc-2c963f66afa7";

function paid(method: string) {
  return {
    data: { kind: "paid", paymentId: PAYMENT_ID, amount: 5000, currency: "XAF", method, paidAt: "2026-10-01T10:00:00Z" },
    error: null,
  };
}

async function renderDialog() {
  const { VoidRegistrationFeeDialog } = await import("./VoidRegistrationFeeDialog");
  const onDone = vi.fn();
  render(<VoidRegistrationFeeDialog member={MEMBER} onClose={vi.fn()} onDone={onDone} />);
  return { onDone };
}

describe("VoidRegistrationFeeDialog (Story 18.6)", () => {
  beforeEach(() => {
    getMemberRegistrationFeeStateAction.mockReset();
    voidRegistrationFeeAction.mockReset();
  });

  it("for a manual fee: says it is not a refund, requires a reason, and voids the payment", async () => {
    getMemberRegistrationFeeStateAction.mockResolvedValue(paid("cash"));
    voidRegistrationFeeAction.mockResolvedValue({ error: null });
    const user = userEvent.setup();
    const { onDone } = await renderDialog();

    expect(await screen.findByText("members.feeVoid.notARefund")).toBeInTheDocument();
    const en = (await import("@/locales/en.json")).default as { members: { feeVoid: { notARefund: string } } };
    expect(en.members.feeVoid.notARefund).toMatch(/not a refund/i);

    const confirm = screen.getByRole("button", { name: "members.feeVoid.confirmButton|Alice" });
    expect(confirm).toBeDisabled();
    await user.type(screen.getByLabelText("members.feeVoid.reason"), "Recorded on the wrong member");
    await user.click(confirm);

    await waitFor(() =>
      expect(voidRegistrationFeeAction).toHaveBeenCalledWith({
        paymentId: PAYMENT_ID,
        reason: "Recorded on the wrong member",
      }),
    );
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it("for a Tara fee: shows the hint and no submit", async () => {
    getMemberRegistrationFeeStateAction.mockResolvedValue(paid("mobile_money"));
    await renderDialog();

    expect(await screen.findByText("members.feeVoid.taraHint")).toBeInTheDocument();
    expect(screen.queryByLabelText("members.feeVoid.reason")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /members.feeVoid.confirmButton/ })).not.toBeInTheDocument();
  });

  it("for a waived member: nothing to void, no submit", async () => {
    getMemberRegistrationFeeStateAction.mockResolvedValue({
      data: { kind: "waived", waivedByName: null, reason: null },
      error: null,
    });
    await renderDialog();

    expect(await screen.findByText("members.feeVoid.nothingToVoid")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /members.feeVoid.confirmButton/ })).not.toBeInTheDocument();
  });

  it("shows the mapped not_found: payment copy and stays open when the void fails", async () => {
    getMemberRegistrationFeeStateAction.mockResolvedValue(paid("cash"));
    voidRegistrationFeeAction.mockResolvedValue({
      error: { code: "payment_not_found", message: "This payment could not be found." },
    });
    const user = userEvent.setup();
    const { onDone } = await renderDialog();

    await screen.findByText("members.feeVoid.notARefund");
    await user.type(screen.getByLabelText("members.feeVoid.reason"), "Recorded on the wrong member");
    await user.click(screen.getByRole("button", { name: "members.feeVoid.confirmButton|Alice" }));

    expect(await screen.findByText("This payment could not be found.")).toBeInTheDocument();
    expect(onDone).not.toHaveBeenCalled();
  });

  it("disables the submit while pending and sends one request", async () => {
    getMemberRegistrationFeeStateAction.mockResolvedValue(paid("cash"));
    let resolveCall: (value: unknown) => void = () => {};
    voidRegistrationFeeAction.mockReturnValue(new Promise((resolve) => (resolveCall = resolve)));
    const user = userEvent.setup();
    await renderDialog();

    await screen.findByText("members.feeVoid.notARefund");
    await user.type(screen.getByLabelText("members.feeVoid.reason"), "Recorded on the wrong member");
    await user.click(screen.getByRole("button", { name: "members.feeVoid.confirmButton|Alice" }));

    const pending = await screen.findByRole("button", { name: "members.feeVoid.voiding" });
    expect(pending).toBeDisabled();
    await user.click(pending);
    expect(voidRegistrationFeeAction).toHaveBeenCalledTimes(1);
    resolveCall({ error: null });
  });

  it("shows a load error and no submit when the fee state cannot be read", async () => {
    getMemberRegistrationFeeStateAction.mockResolvedValue({ data: null, error: { code: "unknown", message: "Boom" } });
    await renderDialog();

    expect(await screen.findByText("Boom")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /members.feeVoid.confirmButton/ })).not.toBeInTheDocument();
  });
});
