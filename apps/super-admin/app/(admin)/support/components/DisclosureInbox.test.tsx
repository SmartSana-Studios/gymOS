import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { createInstance } from "i18next";

import { RESOURCES } from "@/lib/i18n/get-server-translation";

const answerDisclosureRequest = vi.fn(async () => ({ data: { code: "ok" }, error: null }));
vi.mock("../actions", () => ({ answerDisclosureRequest: (...a: unknown[]) => (answerDisclosureRequest as (...x: unknown[]) => unknown)(...a) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { DisclosureInbox } from "./DisclosureInbox";

const BASE = {
  id: "r1", gymId: "g1", gymName: "Gym A", auditLogId: "a1", auditActionType: "refund_recorded", auditCreatedAt: "2026-10-20T10:00:00Z",
  question: "Who made this change?", requestedAt: "2026-10-21T10:00:00Z", answerDueAt: "2026-10-26T10:00:00Z", overdue: false, answeredAt: null, answer: null,
};

function renderInbox(requests: (typeof BASE)[]) {
  const i18n = createInstance();
  i18n.use(initReactI18next).init({ lng: "en", resources: RESOURCES, interpolation: { escapeValue: false }, react: { useSuspense: false } });
  return render(
    <I18nextProvider i18n={i18n}>
      <DisclosureInbox requests={requests} />
    </I18nextProvider>,
  );
}

describe("DisclosureInbox", () => {
  it("lists an open request with the gym and the question, and sends the answer", async () => {
    renderInbox([BASE]);
    expect(screen.getByText("Gym A")).toBeTruthy();
    expect(screen.getByText("Who made this change?")).toBeTruthy();
    const send = screen.getByRole("button", { name: "Send answer" }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Answer"), { target: { value: "Reviewed and recorded." } });
    expect(send.disabled).toBe(false);
    fireEvent.click(send);
    await waitFor(() => expect(answerDisclosureRequest).toHaveBeenCalledWith({ requestId: "r1", answer: "Reviewed and recorded." }));
  });

  it("marks an overdue request and shows an answered one with its answer", () => {
    renderInbox([{ ...BASE, overdue: true }, { ...BASE, id: "r2", question: "Another?", answeredAt: "2026-10-22T10:00:00Z", answer: "Done." } as never]);
    expect(screen.getByText(/Overdue, answer was due/)).toBeTruthy();
    expect(screen.getByText("Done.")).toBeTruthy();
  });

  it("says so when there are none", () => {
    renderInbox([]);
    expect(screen.getByText("No disclosure requests.")).toBeTruthy();
  });
});
