import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const recertifySupportAccount = vi.fn();
const startSupportFactorReset = vi.fn();
const changeSupportContact = vi.fn();
vi.mock("../actions", () => ({
  recertifySupportAccount: (...a: unknown[]) => recertifySupportAccount(...a),
  startSupportFactorReset: (...a: unknown[]) => startSupportFactorReset(...a),
  changeSupportContact: (...a: unknown[]) => changeSupportContact(...a),
}));
vi.mock("@/components/step-up-prompt", () => ({
  StepUpPrompt: ({ action, subjectId, onIssued }: { action: string; subjectId: string; onIssued: () => void }) => (
    <button onClick={onIssued}>{`step-up ${action} ${subjectId}`}</button>
  ),
}));
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { SupportLifecyclePanel } from "./SupportLifecyclePanel";
import { menuItems, modal, pickRowAction, renderWithI18n } from "./support-test-utils";
import type { SupportLifecycleRow } from "../actions";

const ROW: SupportLifecycleRow = {
  userId: "u1", displayName: "Pat", email: "pat@gymosapps.com", activated: true, deactivated: false, lockedAt: null, lockedReason: null,
  recertifyDueAt: "2026-12-01T10:00:00Z", recertificationLapsed: false, resetPendingAt: null, resetState: null, resetExecutesAt: null, lastActiveAt: null,
};
const WHY = "Why are you doing this?";

function renderPanel(rows: SupportLifecycleRow[], onMessage = vi.fn()) {
  renderWithI18n(<SupportLifecyclePanel rows={rows} onMessage={onMessage} />);
  return onMessage;
}

describe("SupportLifecyclePanel", () => {
  beforeEach(() => {
    [recertifySupportAccount, startSupportFactorReset, changeSupportContact, refresh].forEach((m) => m.mockReset());
  });

  it("says so with no activated person; only activated, not deactivated people are listed", () => {
    renderPanel([{ ...ROW, activated: false }, { ...ROW, userId: "u2", deactivated: true }]);
    expect(screen.getByText("No activated support person.")).toBeTruthy();
  });

  it("shows a lapsed recertification", () => {
    renderPanel([{ ...ROW, recertificationLapsed: true }]);
    expect(screen.getByText(/Recertification overdue since/)).toBeTruthy();
  });

  it("recertifies with the reason from its modal", async () => {
    recertifySupportAccount.mockResolvedValue({ data: { code: "recertified", assignmentId: null }, error: null });
    const user = userEvent.setup();
    const onMessage = renderPanel([ROW]);
    await pickRowAction(user, "Pat", "Recertify");
    const m = await modal();
    expect((m.getByRole("button", { name: "Recertify" }) as HTMLButtonElement).disabled).toBe(true);
    await user.type(m.getByPlaceholderText(WHY), "quarterly review");
    await user.click(m.getByRole("button", { name: "Recertify" }));
    await waitFor(() => expect(recertifySupportAccount).toHaveBeenCalledWith({ userId: "u1", reason: "quarterly review" }));
    await waitFor(() => expect(onMessage).toHaveBeenCalledWith(expect.objectContaining({ kind: "ok" })));
  });

  it("reset needs an identity note, asks for the step-up when the server says so, then starts it", async () => {
    startSupportFactorReset
      .mockResolvedValueOnce({ data: null, error: { code: "step_up_required", message: "stepUp.title" } })
      .mockResolvedValueOnce({ data: { executesAt: "2026-10-21T12:30:00Z" }, error: null });
    const user = userEvent.setup();
    const onMessage = renderPanel([ROW]);
    await pickRowAction(user, "Pat", "Reset authenticator");
    const m = await modal();
    expect((m.getByRole("button", { name: "Start reset" }) as HTMLButtonElement).disabled).toBe(true);
    await user.type(m.getByPlaceholderText(/How did you confirm/), "called back on the number on file");
    await user.click(m.getByRole("button", { name: "Start reset" }));
    await user.click(await screen.findByRole("button", { name: "step-up start_support_factor_reset u1" }));
    await waitFor(() => expect(startSupportFactorReset).toHaveBeenCalledTimes(2));
    expect(startSupportFactorReset).toHaveBeenLastCalledWith({ userId: "u1", identityNote: "called back on the number on file" });
    await waitFor(() => expect(onMessage).toHaveBeenCalledWith(expect.objectContaining({ kind: "ok" })));
  });

  it("a person with a reset open can only be recertified", async () => {
    const user = userEvent.setup();
    renderPanel([{ ...ROW, resetPendingAt: "2026-10-21T10:00:00Z", resetState: "cooling_off", resetExecutesAt: "2026-10-21T10:30:00Z" }]);
    expect(screen.getAllByText(/Reset waiting until/).length).toBeGreaterThan(0);
    expect(await menuItems(user, "Pat")).toEqual(["Recertify"]);
  });

  it("a person with no reset open can be recertified, reset or have the address changed", async () => {
    const user = userEvent.setup();
    renderPanel([ROW]);
    expect(await menuItems(user, "Pat")).toEqual(["Recertify", "Reset authenticator", "Change address"]);
  });

  it("changes the address with the new address and the reason", async () => {
    changeSupportContact.mockResolvedValue({ data: { code: "changed", assignmentId: null }, error: null });
    const user = userEvent.setup();
    const onMessage = renderPanel([ROW]);
    await pickRowAction(user, "Pat", "Change address");
    const m = await modal();
    const submit = m.getAllByRole("button", { name: "Change address" }).pop() as HTMLButtonElement;
    await user.type(m.getByPlaceholderText("name@gymosapps.com"), "new@gymosapps.com");
    expect(submit.disabled).toBe(true);
    await user.type(m.getByPlaceholderText(WHY), "name change");
    await user.click(submit);
    await waitFor(() => expect(changeSupportContact).toHaveBeenCalledWith({ userId: "u1", email: "new@gymosapps.com", reason: "name change" }));
    await waitFor(() => expect(onMessage).toHaveBeenCalledWith(expect.objectContaining({ kind: "ok" })));
  });

  it("paginates", async () => {
    const user = userEvent.setup();
    renderPanel(Array.from({ length: 11 }, (_, i) => ({ ...ROW, userId: `u${i}`, displayName: `P${i}` })));
    expect(screen.getAllByRole("row")).toHaveLength(11);
    await user.click(screen.getAllByRole("button", { name: /next/i })[0]);
    expect(screen.getAllByRole("row")).toHaveLength(2);
  });
});
