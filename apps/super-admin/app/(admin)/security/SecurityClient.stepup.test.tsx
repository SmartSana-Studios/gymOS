/** The step-up retry loop on removing an authenticator (epic 22 retro item 81, the 22-7 deferral): ask for a code, then retry. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { createInstance } from "i18next";

import enTranslations from "../../../locales/en.json";

const removeFactor = vi.fn();
const assign = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("./actions", () => ({
  enrollFactor: vi.fn(),
  verifyFactor: vi.fn(),
  removeFactor: (...a: unknown[]) => removeFactor(...a),
}));
vi.mock("./RecoverySection", () => ({ RecoverySection: () => null }));
vi.mock("@/components/enroll-dialog", () => ({ EnrollDialog: () => null }));
// The real prompt verifies a TOTP; here it only exposes the two callbacks the page wires to it.
vi.mock("@/components/step-up-prompt", () => ({
  StepUpPrompt: (p: { action: string; subjectId: string; onIssued: () => void; onCancel: () => void }) => (
    <div data-testid="prompt" data-action={p.action} data-subject={p.subjectId}>
      <button onClick={p.onIssued}>code accepted</button>
      <button onClick={p.onCancel}>cancel prompt</button>
    </div>
  ),
}));

import { SecurityClient } from "./SecurityClient";

function renderIt() {
  const i18n = createInstance();
  i18n.use(initReactI18next).init({ lng: "en", resources: { en: { translation: enTranslations } } });
  return render(
    <I18nextProvider i18n={i18n}>
      <SecurityClient
        initialFactors={[{ id: "factor-2", friendlyName: "Authenticator 2", status: "verified", createdAt: "2026-10-19T00:00:00Z" }]}
        recovery={{ hasEmail: false, masked: null, pendingApplyAt: null }}
      />
    </I18nextProvider>,
  );
}

const needsStepUp = { data: null, error: { code: "step_up_required", message: "step up" } };

beforeEach(() => {
  removeFactor.mockReset();
  assign.mockReset();
  Object.defineProperty(window, "location", { configurable: true, value: { ...window.location, assign } });
});

describe("SecurityClient step-up retry loop", () => {
  it("asks for a code bound to this factor, and retries the removal for the same factor once it is accepted", async () => {
    removeFactor
      .mockResolvedValueOnce(needsStepUp)
      .mockResolvedValueOnce({ data: { removed: true, signedOut: false, signOutFailed: false, auditFailed: false }, error: null });
    renderIt();
    await userEvent.click(screen.getByRole("button", { name: "Remove" }));

    const prompt = await screen.findByTestId("prompt");
    expect(prompt.getAttribute("data-action")).toBe("remove_super_admin_factor");
    expect(prompt.getAttribute("data-subject")).toBe("factor-2");
    expect(removeFactor).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole("button", { name: "code accepted" }));
    await waitFor(() => expect(removeFactor).toHaveBeenCalledTimes(2));
    expect(removeFactor).toHaveBeenLastCalledWith({ factorId: "factor-2" });
    await waitFor(() => expect(screen.queryByTestId("prompt")).toBeNull());
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("cancelling the prompt closes it and does not retry", async () => {
    removeFactor.mockResolvedValueOnce(needsStepUp);
    renderIt();
    await userEvent.click(screen.getByRole("button", { name: "Remove" }));
    await screen.findByTestId("prompt");
    await userEvent.click(screen.getByRole("button", { name: "cancel prompt" }));
    await waitFor(() => expect(screen.queryByTestId("prompt")).toBeNull());
    expect(removeFactor).toHaveBeenCalledTimes(1);
  });

  it("a real error after the retry is shown and the prompt does not come back", async () => {
    removeFactor
      .mockResolvedValueOnce(needsStepUp)
      .mockResolvedValueOnce({ data: null, error: { code: "last_factor", message: "You cannot remove your last verified authenticator." } });
    renderIt();
    await userEvent.click(screen.getByRole("button", { name: "Remove" }));
    await screen.findByTestId("prompt");
    await userEvent.click(screen.getByRole("button", { name: "code accepted" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("You cannot remove your last verified authenticator."));
    expect(removeFactor).toHaveBeenCalledTimes(2);
  });

  it("does not loop: a second step-up demand re-opens the prompt, once per demand", async () => {
    removeFactor.mockResolvedValue(needsStepUp);
    renderIt();
    await userEvent.click(screen.getByRole("button", { name: "Remove" }));
    await screen.findByTestId("prompt");
    await userEvent.click(screen.getByRole("button", { name: "code accepted" }));
    await waitFor(() => expect(removeFactor).toHaveBeenCalledTimes(2));
    await new Promise((r) => setTimeout(r, 50));
    expect(removeFactor).toHaveBeenCalledTimes(2); // one retry per accepted code, never an automatic loop
    expect(screen.getByTestId("prompt")).toBeTruthy();
  });
});
