/** Adding a second authenticator from a password-only session says what to do, with a link (epic 22 retro item 73). */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { createInstance } from "i18next";

import enTranslations from "../../../locales/en.json";

const enrollFactor = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("./actions", () => ({
  enrollFactor: (...a: unknown[]) => enrollFactor(...a),
  verifyFactor: vi.fn(),
  removeFactor: vi.fn(),
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
        initialFactors={[{ id: "f1", friendlyName: "Authenticator 1", status: "verified", createdAt: "2026-10-19T00:00:00Z" }]}
        recovery={{ hasEmail: false, masked: null, pendingApplyAt: null }}
      />
    </I18nextProvider>,
  );
}

beforeEach(() => enrollFactor.mockReset());

describe("SecurityClient add authenticator", () => {
  it("explains what to do and links to the code page when a verification is needed first", async () => {
    enrollFactor.mockResolvedValue({ data: null, error: { code: "aal2_required", message: enTranslations.security.errors.verifyFirst } });
    renderIt();
    await userEvent.click(screen.getByRole("button", { name: enTranslations.security.addFactor }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain(enTranslations.security.errors.verifyFirst));
    const link = screen.getByRole("link", { name: enTranslations.security.errors.verifyFirstLink });
    expect(link.getAttribute("href")).toBe("/auth/mfa");
  });

  it("shows no link for any other error", async () => {
    enrollFactor.mockResolvedValue({ data: null, error: { code: "enroll_failed", message: "Something else" } });
    renderIt();
    await userEvent.click(screen.getByRole("button", { name: enTranslations.security.addFactor }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Something else"));
    expect(screen.queryByRole("link")).toBeNull();
  });
});
