/**
 * Story 19.9b: session payments become refund-eligible, and the modal says
 * what the refund will do (cancel an unused session, keep it on a partial
 * refund, leave a used one counted), plus the loyalty clauses only when
 * loyalty is on. The success callback carries the server's resolved outcome.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const listRefundEligiblePaymentsAction = vi.fn();
const recordRefundAction = vi.fn();

vi.mock("../actions", () => ({
  listRefundEligiblePaymentsAction: (...args: unknown[]) => listRefundEligiblePaymentsAction(...args),
  recordRefundAction: (...args: unknown[]) => recordRefundAction(...args),
  searchMembersForPaymentAction: vi.fn(async () => ({
    data: [{ id: "m1", name: "Alice", phone: null, planType: "pay_per_session" }],
    error: null,
  })),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) => (vars ? `${key}|${Object.values(vars).join("|")}` : key),
    i18n: { language: "en" },
  }),
}));

import { RecordRefundModal } from "./RecordRefundModal";

const sessionPayment = (overrides: Record<string, unknown> = {}) => ({
  id: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  amount: 2000,
  currency: "XAF",
  method: "cash",
  createdAt: "2026-10-11T08:00:00Z",
  purpose: "session",
  sessionState: "unused",
  ...overrides,
});
const renewalPayment = {
  id: "4fa85f64-5717-4562-b3fc-2c963f66afa7",
  amount: 15000,
  currency: "XAF",
  method: "cash",
  createdAt: "2026-10-10T08:00:00Z",
  purpose: "subscription",
  sessionState: null,
};

async function openWith(payments: unknown[], props: { loyaltyEnabled?: boolean } = {}) {
  listRefundEligiblePaymentsAction.mockResolvedValue({ data: payments, error: null });
  const onSaved = vi.fn();
  const user = userEvent.setup();
  render(<RecordRefundModal recordedByName="Rita" onClose={vi.fn()} onSaved={onSaved} {...props} />);
  await user.type(screen.getByLabelText("payments.refundModal.member"), "Ali");
  await user.click(await screen.findByRole("button", { name: /Alice/ }));
  return { user, onSaved };
}

describe("RecordRefundModal session refunds (Story 19.9b)", () => {
  beforeEach(() => {
    listRefundEligiblePaymentsAction.mockReset();
    recordRefundAction.mockReset();
  });

  it("offers a session payment and says a full refund of an unused session cancels it", async () => {
    const { user } = await openWith([sessionPayment()]);

    await user.click(await screen.findByRole("radio"));

    expect(screen.getByRole("status")).toHaveTextContent("payments.refundModal.notice.sessionCancelled");
  });

  it("says a partial refund keeps the session", async () => {
    const { user } = await openWith([sessionPayment()]);
    await user.click(await screen.findByRole("radio"));

    const amount = screen.getByLabelText("payments.refundModal.amount");
    await user.clear(amount);
    await user.type(amount, "500");

    expect(screen.getByRole("status")).toHaveTextContent("payments.refundModal.notice.sessionPartial");
  });

  it("shows no session notice for an empty or zero amount", async () => {
    const { user } = await openWith([sessionPayment()]);
    await user.click(await screen.findByRole("radio"));
    const amount = screen.getByLabelText("payments.refundModal.amount");

    await user.clear(amount);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    await user.type(amount, "0");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("says the visit stays counted for a used session, with the loyalty clause only when loyalty is on", async () => {
    const first = await openWith([sessionPayment({ sessionState: "used" })]);
    await first.user.click(await screen.findByRole("radio"));
    const notice = screen.getByRole("status");
    expect(notice).toHaveTextContent("payments.refundModal.notice.sessionUsed");
    expect(notice).not.toHaveTextContent("sessionUsedLoyalty");
  });

  it("adds the loyalty clause for a used session when loyalty is on", async () => {
    const { user } = await openWith([sessionPayment({ sessionState: "used" })], { loyaltyEnabled: true });
    await user.click(await screen.findByRole("radio"));

    expect(screen.getByRole("status")).toHaveTextContent("payments.refundModal.notice.sessionUsedLoyalty");
  });

  it("shows the renewal loyalty line only when loyalty is on", async () => {
    const { user } = await openWith([renewalPayment], { loyaltyEnabled: true });
    await user.click(await screen.findByRole("radio"));

    expect(screen.getByRole("status")).toHaveTextContent("payments.refundModal.notice.renewalLoyalty");
  });

  it("shows no notice for a renewal when loyalty is off", async () => {
    const { user } = await openWith([renewalPayment]);
    await user.click(await screen.findByRole("radio"));

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("passes the server's resolved session outcome to onSaved", async () => {
    recordRefundAction.mockResolvedValue({ data: { id: "r1", sessionOutcome: "used" }, error: null });
    const { user, onSaved } = await openWith([sessionPayment()]);
    await user.click(await screen.findByRole("radio"));
    await user.type(screen.getByLabelText("payments.refundModal.reason"), "Guest asked for money back");

    await user.click(screen.getByRole("button", { name: "payments.refundModal.recordButton" }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(undefined, "used"));
  });
});
