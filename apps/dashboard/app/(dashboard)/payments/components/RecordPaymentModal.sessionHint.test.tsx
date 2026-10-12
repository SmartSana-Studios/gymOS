/**
 * Story 19.9b (AD-10): selecting a Pay-per-session member at a charging gym
 * shows a hint toward Record session payment on the member's page. No Session
 * purpose is added to the modal.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../actions", () => ({
  recordPayment: vi.fn(),
  searchMembersForPaymentAction: vi.fn(async (query: string) => ({
    data: [
      { id: "m1", name: `Per ${query}`, phone: null, planType: "pay_per_session" },
      { id: "m2", name: `Monthly ${query}`, phone: null, planType: "monthly" },
    ],
    error: null,
  })),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));

import { RecordPaymentModal } from "./RecordPaymentModal";

async function selectMember(name: RegExp, charging: boolean) {
  const user = userEvent.setup();
  render(<RecordPaymentModal recordedByName="Rita" chargeGuestsPerSession={charging} onClose={vi.fn()} onSaved={vi.fn()} />);
  await user.type(screen.getByLabelText("payments.modal.member"), "Al");
  await user.click(await screen.findByRole("button", { name }));
}

describe("RecordPaymentModal session hint (Story 19.9b)", () => {
  it("hints for a Pay-per-session member at a charging gym", async () => {
    await selectMember(/Per Al/, true);
    expect(screen.getByText("payments.modal.sessionHint")).toBeInTheDocument();
  });

  it("does not hint when the gym is not charging", async () => {
    await selectMember(/Per Al/, false);
    expect(screen.queryByText("payments.modal.sessionHint")).not.toBeInTheDocument();
  });

  it("does not hint for a member on another plan type", async () => {
    await selectMember(/Monthly Al/, true);
    expect(screen.queryByText("payments.modal.sessionHint")).not.toBeInTheDocument();
  });
});
