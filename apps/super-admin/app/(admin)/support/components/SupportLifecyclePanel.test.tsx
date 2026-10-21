import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { createInstance } from "i18next";

import { RESOURCES } from "@/lib/i18n/get-server-translation";

const recertifySupportAccount = vi.fn();
const startSupportFactorReset = vi.fn();
const changeSupportContact = vi.fn();
const runDueFactorResets = vi.fn();
vi.mock("../actions", () => ({
  recertifySupportAccount: (...a: unknown[]) => recertifySupportAccount(...a),
  startSupportFactorReset: (...a: unknown[]) => startSupportFactorReset(...a),
  changeSupportContact: (...a: unknown[]) => changeSupportContact(...a),
  runDueFactorResets: (...a: unknown[]) => runDueFactorResets(...a),
}));
vi.mock("@/components/step-up-prompt", () => ({
  StepUpPrompt: ({ action, subjectId, onIssued }: { action: string; subjectId: string; onIssued: () => void }) => (
    <button onClick={onIssued}>{`step-up ${action} ${subjectId}`}</button>
  ),
}));
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { SupportLifecyclePanel } from "./SupportLifecyclePanel";
import type { SupportLifecycleRow } from "../actions";

const ROW: SupportLifecycleRow = {
  userId: "u1", displayName: "Pat", email: "pat@gymosapps.com", activated: true, deactivated: false, lockedAt: null, lockedReason: null,
  recertifyDueAt: "2026-12-01T10:00:00Z", recertificationLapsed: false, resetPendingAt: null, resetState: null, resetExecutesAt: null, lastActiveAt: null,
};

function renderPanel(rows: SupportLifecycleRow[], reason = "", onMessage = vi.fn()) {
  const i18n = createInstance();
  i18n.use(initReactI18next).init({ lng: "en", resources: RESOURCES, interpolation: { escapeValue: false }, react: { useSuspense: false } });
  render(
    <I18nextProvider i18n={i18n}>
      <SupportLifecyclePanel rows={rows} reason={reason} onMessage={onMessage} />
    </I18nextProvider>,
  );
  return onMessage;
}

describe("SupportLifecyclePanel", () => {
  beforeEach(() => {
    [recertifySupportAccount, startSupportFactorReset, changeSupportContact, runDueFactorResets, refresh].forEach((m) => m.mockReset());
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  it("says so with no activated person; only activated, not deactivated people are listed", () => {
    renderPanel([{ ...ROW, activated: false }, { ...ROW, userId: "u2", deactivated: true }]);
    expect(screen.getByText("No activated support person.")).toBeTruthy();
  });

  it("shows a lapsed recertification and needs a reason to recertify", () => {
    renderPanel([{ ...ROW, recertificationLapsed: true }]);
    expect(screen.getByText(/Recertification overdue since/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Recertify" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("recertifies with the recorded reason", async () => {
    recertifySupportAccount.mockResolvedValue({ data: { code: "recertified", assignmentId: null }, error: null });
    const onMessage = renderPanel([ROW], "quarterly review");
    fireEvent.click(screen.getByRole("button", { name: "Recertify" }));
    await waitFor(() => expect(recertifySupportAccount).toHaveBeenCalledWith({ userId: "u1", reason: "quarterly review" }));
    await waitFor(() => expect(onMessage).toHaveBeenCalledWith(expect.objectContaining({ kind: "ok" })));
  });

  it("reset needs an identity note, asks for the step-up when the server says so, then starts it", async () => {
    startSupportFactorReset
      .mockResolvedValueOnce({ data: null, error: { code: "step_up_required", message: "stepUp.title" } })
      .mockResolvedValueOnce({ data: { executesAt: "2026-10-21T12:30:00Z" }, error: null });
    const onMessage = renderPanel([ROW]);
    fireEvent.click(screen.getByRole("button", { name: "Reset authenticator" }));
    const start = screen.getByRole("button", { name: "Start reset" }) as HTMLButtonElement;
    expect(start.disabled).toBe(true);
    fireEvent.change(screen.getByPlaceholderText(/How did you confirm/), { target: { value: "called back on the number on file" } });
    fireEvent.click(screen.getByRole("button", { name: "Start reset" }));
    const prompt = await screen.findByRole("button", { name: "step-up start_support_factor_reset u1" });
    fireEvent.click(prompt);
    await waitFor(() => expect(startSupportFactorReset).toHaveBeenCalledTimes(2));
    expect(startSupportFactorReset).toHaveBeenLastCalledWith({ userId: "u1", identityNote: "called back on the number on file" });
    await waitFor(() => expect(onMessage).toHaveBeenCalledWith(expect.objectContaining({ kind: "ok" })));
  });

  it("a person with a reset open cannot be reset again or have the address changed", () => {
    renderPanel([{ ...ROW, resetPendingAt: "2026-10-21T10:00:00Z", resetState: "cooling_off", resetExecutesAt: "2026-10-21T10:30:00Z" }]);
    expect((screen.getByRole("button", { name: "Reset authenticator" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Change address" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Reset waiting until/)).toBeTruthy();
  });

  it("changes the address with the page reason", async () => {
    changeSupportContact.mockResolvedValue({ data: { code: "changed", assignmentId: null }, error: null });
    const onMessage = renderPanel([ROW], "name change");
    fireEvent.click(screen.getByRole("button", { name: "Change address" }));
    fireEvent.change(screen.getByPlaceholderText("name@gymosapps.com"), { target: { value: "new@gymosapps.com" } });
    const buttons = screen.getAllByRole("button", { name: "Change address" });
    fireEvent.click(buttons[buttons.length - 1]);
    await waitFor(() => expect(changeSupportContact).toHaveBeenCalledWith({ userId: "u1", email: "new@gymosapps.com", reason: "name change" }));
    await waitFor(() => expect(onMessage).toHaveBeenCalledWith(expect.objectContaining({ kind: "ok" })));
  });
});
