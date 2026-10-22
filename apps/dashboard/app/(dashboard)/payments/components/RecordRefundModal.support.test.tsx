/** Story 23-6c: a support session types a fresh authenticator code in the refund dialog; staff roles see no field. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const recordRefundAction = vi.fn();
const assign = vi.fn();
const PAYMENT_ID = "3fa85f64-5717-4562-b3fc-2c963f66afa6";

vi.mock("../actions", () => ({
  listRefundEligiblePaymentsAction: vi.fn(async () => ({
    data: [{ id: PAYMENT_ID, amount: 2000, currency: "XAF", method: "cash", createdAt: "2026-10-11T08:00:00Z", purpose: "subscription", sessionState: null }],
    error: null,
  })),
  recordRefundAction: (...a: unknown[]) => recordRefundAction(...a),
  searchMembersForPaymentAction: vi.fn(async () => ({ data: [{ id: "m1", name: "Alice", phone: null, planType: "monthly" }], error: null })),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) => (vars ? `${key}|${Object.values(vars).join("|")}` : key),
    i18n: { language: "en" },
  }),
}));

import { RecordRefundModal } from "./RecordRefundModal";

async function open(isSupport: boolean, code?: string) {
  const onSaved = vi.fn();
  const user = userEvent.setup();
  render(<RecordRefundModal recordedByName="Rita" isSupport={isSupport} onClose={vi.fn()} onSaved={onSaved} />);
  await user.type(screen.getByLabelText("payments.refundModal.member"), "Ali");
  await user.click(await screen.findByRole("button", { name: /Alice/ }));
  await user.click(await screen.findByRole("radio"));
  await user.type(screen.getByLabelText("payments.refundModal.reason"), "Charged twice by mistake");
  if (code && isSupport) await user.type(screen.getByLabelText("supportStepUp.codeLabel"), code);
  await user.click(screen.getByRole("button", { name: "payments.refundModal.recordButton" }));
  return { onSaved };
}

beforeEach(() => {
  vi.clearAllMocks();
  recordRefundAction.mockResolvedValue({ data: { id: "r1", sessionOutcome: null }, error: null });
  Object.defineProperty(window, "location", { value: { assign }, writable: true });
});

describe("RecordRefundModal for support (Story 23-6c)", () => {
  it("sends the code with the refund", async () => {
    const { onSaved } = await open(true, "123456");
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(recordRefundAction).toHaveBeenCalledWith(expect.objectContaining({ paymentId: PAYMENT_ID, authCode: "123456" }));
  });

  it("refuses a missing code before the action", async () => {
    await open(true, "");
    expect(await screen.findByText("supportStepUp.codeRequired")).toBeInTheDocument();
    expect(recordRefundAction).not.toHaveBeenCalled();
  });

  it("shows the inline message for a wrong code and stays open", async () => {
    recordRefundAction.mockResolvedValue({ data: null, error: { code: "invalid_code", message: "not accepted" } });
    const { onSaved } = await open(true, "000000");
    expect(await screen.findByText("not accepted")).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
  });

  it("clears the spent code after an error response so a retry cannot resubmit it", async () => {
    recordRefundAction.mockResolvedValue({ data: null, error: { code: "invalid_code", message: "not accepted" } });
    await open(true, "000000");
    await screen.findByText("not accepted");
    expect(screen.getByLabelText("supportStepUp.codeLabel")).toHaveValue("");
  });

  it("goes to the login page with the expired notice when the account locks", async () => {
    recordRefundAction.mockResolvedValue({ data: null, error: { code: "account_locked", message: "locked" } });
    await open(true, "000000");
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/auth/login?expired=1"));
  });

  it("a staff role sees no code field and sends no code", async () => {
    const { onSaved } = await open(false);
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(screen.queryByLabelText("supportStepUp.codeLabel")).toBeNull();
    expect(recordRefundAction.mock.calls[0][0]).not.toHaveProperty("authCode");
  });
});
