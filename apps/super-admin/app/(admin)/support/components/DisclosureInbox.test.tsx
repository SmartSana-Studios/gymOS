import { describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const answerDisclosureRequest = vi.fn(async (..._a: unknown[]) => ({ data: { code: "ok" }, error: null as null | { message: string } }));
vi.mock("../actions", () => ({ answerDisclosureRequest: (...a: unknown[]) => answerDisclosureRequest(...a) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { DisclosureInbox } from "./DisclosureInbox";
import { menuItems, modal, pickRowAction, renderWithI18n } from "./support-test-utils";

const BASE = {
  id: "r1", gymId: "g1", gymName: "Gym A", auditLogId: "a1", auditActionType: "refund_recorded", auditCreatedAt: "2026-10-20T10:00:00Z",
  question: "Who made this change?", requestedAt: "2026-10-21T10:00:00Z", answerDueAt: "2026-10-26T10:00:00Z", overdue: false, answeredAt: null, answer: null,
};

function renderInbox(requests: (typeof BASE)[], onMessage = vi.fn()) {
  renderWithI18n(<DisclosureInbox requests={requests} onMessage={onMessage} />);
  return onMessage;
}

describe("DisclosureInbox", () => {
  it("lists an open request, and the Answer modal sends the answer once it is 3 characters or more", async () => {
    const user = userEvent.setup();
    const onMessage = renderInbox([BASE]);
    expect(screen.getByText("Gym A")).toBeTruthy();
    expect(screen.getByText("Who made this change?")).toBeTruthy();
    await pickRowAction(user, "Gym A", "Answer");
    const m = await modal();
    const send = m.getByRole("button", { name: "Send answer" }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    await user.type(m.getByLabelText(/Answer/), "Reviewed and recorded.");
    expect(send.disabled).toBe(false);
    await user.click(send);
    await waitFor(() => expect(answerDisclosureRequest).toHaveBeenCalledWith({ requestId: "r1", answer: "Reviewed and recorded." }));
    await waitFor(() => expect(onMessage).toHaveBeenCalledWith(expect.objectContaining({ kind: "ok" })));
  });

  it("shows a refusal in the modal", async () => {
    answerDisclosureRequest.mockResolvedValueOnce({ data: null as never, error: { message: "That request is already answered." } });
    const user = userEvent.setup();
    renderInbox([BASE]);
    await pickRowAction(user, "Gym A", "Answer");
    const m = await modal();
    await user.type(m.getByLabelText(/Answer/), "Done.");
    await user.click(m.getByRole("button", { name: "Send answer" }));
    expect(await m.findByText("That request is already answered.")).toBeTruthy();
  });

  it("marks an overdue request; an answered one shows its answer and offers no action", async () => {
    const user = userEvent.setup();
    renderInbox([{ ...BASE, overdue: true }, { ...BASE, id: "r2", gymName: "Gym B", question: "Another?", answeredAt: "2026-10-22T10:00:00Z", answer: "Done." } as never]);
    expect(screen.getByText(/Overdue, answer was due/)).toBeTruthy();
    expect(screen.getByText("Done.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Actions for Gym B" })).toBeNull();
    expect(await menuItems(user, "Gym A")).toEqual(["Answer"]);
  });

  it("says so when there are none", () => {
    renderInbox([]);
    expect(screen.getByText("No disclosure requests.")).toBeTruthy();
  });

  it("paginates", async () => {
    const user = userEvent.setup();
    renderInbox(Array.from({ length: 11 }, (_, i) => ({ ...BASE, id: `r${i}`, gymName: `Gym ${i}` })));
    expect(screen.getAllByRole("row")).toHaveLength(11);
    await user.click(screen.getAllByRole("button", { name: /next/i })[0]);
    expect(screen.getAllByRole("row")).toHaveLength(2);
  });
});
