/** Removing a factor reports an audit failure (epic 22 retro item 58) instead of hiding it. */
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
vi.mock("@/components/step-up-prompt", () => ({ StepUpPrompt: () => null }));

import { SecurityClient } from "./SecurityClient";

function renderIt() {
  const i18n = createInstance();
  i18n.use(initReactI18next).init({ lng: "en", resources: { en: { translation: enTranslations } } });
  return render(
    <I18nextProvider i18n={i18n}>
      <SecurityClient
        initialFactors={[{ id: "f1", friendlyName: "Authenticator 1", status: "unverified", createdAt: "2026-10-19T00:00:00Z" }]}
        recovery={{ hasEmail: false, masked: null, pendingApplyAt: null }}
      />
    </I18nextProvider>,
  );
}

beforeEach(() => {
  removeFactor.mockReset();
  assign.mockReset();
  Object.defineProperty(window, "location", { configurable: true, value: { ...window.location, assign } });
});

describe("SecurityClient remove", () => {
  it("tells the operator when the factor was removed but the audit record was not written", async () => {
    removeFactor.mockResolvedValue({ data: { removed: true, signedOut: false, signOutFailed: false, auditFailed: true }, error: null });
    renderIt();
    await userEvent.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe(enTranslations.security.errors.removedNotAudited));
  });

  it("shows nothing extra when the audit record was written", async () => {
    removeFactor.mockResolvedValue({ data: { removed: true, signedOut: false, signOutFailed: false, auditFailed: false }, error: null });
    renderIt();
    await userEvent.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(removeFactor).toHaveBeenCalled());
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("reports both problems when the sign-out failed and the audit write failed", async () => {
    removeFactor.mockResolvedValue({ data: { removed: true, signedOut: false, signOutFailed: true, auditFailed: true }, error: null });
    renderIt();
    await userEvent.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() => {
      const text = screen.getByRole("alert").textContent ?? "";
      expect(text).toContain(enTranslations.security.errors.signOutFailed);
      expect(text).toContain(enTranslations.security.errors.removedNotAudited);
    });
  });

  it("goes to sign-in when every session ended", async () => {
    removeFactor.mockResolvedValue({ data: { removed: true, signedOut: true, signOutFailed: false, auditFailed: true }, error: null });
    renderIt();
    await userEvent.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/auth/login?expired=1"));
  });
});
