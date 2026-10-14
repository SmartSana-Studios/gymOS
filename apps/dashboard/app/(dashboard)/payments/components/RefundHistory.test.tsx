import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) => (vars ? `${key}:${JSON.stringify(vars)}` : key),
    i18n: { language: "en" },
  }),
}));

import { RefundHistory } from "./RefundHistory";

const row = {
  id: "r1", paymentId: "p1", memberName: "Gina", amount: 5000, paymentAmount: 15000, currency: "XAF",
  method: "cash", purpose: "subscription", reason: "Wrong plan", createdAt: "2026-10-12T10:00:00Z",
  actorName: "Staff Sam", sessionState: null,
} as const;

describe("RefundHistory", () => {
  it("lists who, what, why and by whom, with the partial note", () => {
    render(<RefundHistory refunds={{ rows: [row], total: 1 }} hasError={false} />);
    expect(screen.getByText("Gina")).toBeTruthy();
    expect(screen.getByText("Wrong plan")).toBeTruthy();
    expect(screen.getByText("Staff Sam")).toBeTruthy();
    expect(screen.getByText(/payments\.refundHistory\.partial/)).toBeTruthy();
  });

  it("names the session outcome for a session refund", () => {
    render(<RefundHistory refunds={{ rows: [{ ...row, purpose: "session", paymentAmount: 5000, sessionState: "used" }], total: 1 }} hasError={false} />);
    expect(screen.getByText("payments.refundHistory.session.used")).toBeTruthy();
    expect(screen.queryByText(/payments\.refundHistory\.partial/)).toBeNull();
  });

  it("shows the empty and error states, and a truncation note", () => {
    const { rerender } = render(<RefundHistory refunds={{ rows: [], total: 0 }} hasError={false} />);
    expect(screen.getByText("payments.refundHistory.empty")).toBeTruthy();
    rerender(<RefundHistory refunds={null} hasError />);
    expect(screen.getByText("payments.refundHistory.loadError")).toBeTruthy();
    rerender(<RefundHistory refunds={{ rows: [row], total: 250 }} hasError={false} />);
    expect(screen.getByText(/payments\.refundHistory\.truncated/)).toBeTruthy();
  });
});
