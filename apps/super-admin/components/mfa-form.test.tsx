import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { createInstance } from "i18next";

import enTranslations from "../locales/en.json";

const push = vi.fn();
const refresh = vi.fn();
const listFactors = vi.fn();
const challengeAndVerify = vi.fn();
const requestRecoveryCode = vi.fn();
const submitRecoveryCode = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));
vi.mock("@/app/auth/mfa/recovery-actions", () => ({
  requestRecoveryCode: (...a: unknown[]) => requestRecoveryCode(...a),
  submitRecoveryCode: (...a: unknown[]) => submitRecoveryCode(...a),
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { mfa: { listFactors, challengeAndVerify } } }),
}));

import { MfaForm } from "./mfa-form";

function renderForm() {
  const i18n = createInstance();
  i18n.use(initReactI18next).init({ lng: "en", resources: { en: { translation: enTranslations } } });
  return render(
    <I18nextProvider i18n={i18n}>
      <MfaForm />
    </I18nextProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  listFactors.mockResolvedValue({ data: { totp: [{ id: "f1" }] }, error: null });
});

describe("MfaForm", () => {
  it("a correct code verifies the existing factor and goes to /gyms", async () => {
    challengeAndVerify.mockResolvedValue({ data: {}, error: null });
    renderForm();
    await waitFor(() => expect(screen.getByRole("button", { name: "Verify" })).not.toBeDisabled());
    await userEvent.type(screen.getByLabelText("6-digit code"), "123456");
    await userEvent.click(screen.getByRole("button", { name: "Verify" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/gyms"));
    expect(challengeAndVerify).toHaveBeenCalledWith({ factorId: "f1", code: "123456" });
  });

  it("with two factors it falls through to the one whose device answers", async () => {
    listFactors.mockResolvedValue({ data: { totp: [{ id: "f1" }, { id: "f2" }] }, error: null });
    challengeAndVerify
      .mockResolvedValueOnce({ data: null, error: { message: "bad" } })
      .mockResolvedValueOnce({ data: {}, error: null });
    renderForm();
    await waitFor(() => expect(screen.getByRole("button", { name: "Verify" })).not.toBeDisabled());
    await userEvent.type(screen.getByLabelText("6-digit code"), "123456");
    await userEvent.click(screen.getByRole("button", { name: "Verify" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/gyms"));
    expect(challengeAndVerify).toHaveBeenLastCalledWith({ factorId: "f2", code: "123456" });
  });

  it("a wrong code shows an error and stays", async () => {
    challengeAndVerify.mockResolvedValue({ data: null, error: { message: "bad" } });
    renderForm();
    await waitFor(() => expect(screen.getByRole("button", { name: "Verify" })).not.toBeDisabled());
    await userEvent.type(screen.getByLabelText("6-digit code"), "000000");
    await userEvent.click(screen.getByRole("button", { name: "Verify" }));
    expect(await screen.findByText(enTranslations.mfaPrompt.invalidCode)).toBeTruthy();
    expect(push).not.toHaveBeenCalled();
  });

  it("with no verified factor it shows the message and never enrolls", async () => {
    listFactors.mockResolvedValue({ data: { totp: [] }, error: null });
    renderForm();
    expect(await screen.findByText(enTranslations.mfaPrompt.noFactor)).toBeTruthy();
    expect(challengeAndVerify).not.toHaveBeenCalled();
  });

  describe("recovery", () => {
    it("asks for a code, then shows when the reset is scheduled", async () => {
      requestRecoveryCode.mockResolvedValue({ data: { requested: true }, error: null });
      submitRecoveryCode.mockResolvedValue({ data: { applyAt: "2026-10-16T12:30:00Z" }, error: null });
      renderForm();
      await waitFor(() => expect(screen.getByRole("button", { name: "Verify" })).not.toBeDisabled());
      await userEvent.click(screen.getByRole("button", { name: "Can't use your authenticator?" }));
      await userEvent.click(screen.getByRole("button", { name: "Email me a code" }));
      await userEvent.type(await screen.findByLabelText("Recovery code"), "654321");
      await userEvent.click(screen.getByRole("button", { name: "Confirm" }));
      expect(await screen.findByRole("status")).toHaveTextContent("Recovery requested");
      expect(submitRecoveryCode).toHaveBeenCalledWith({ code: "654321" });
      expect(push).not.toHaveBeenCalled(); // a recovery code never signs anyone in
    });

    it("shows a wrong recovery code and stays", async () => {
      requestRecoveryCode.mockResolvedValue({ data: { requested: true }, error: null });
      submitRecoveryCode.mockResolvedValue({ data: null, error: { code: "invalid_code", message: "That code is not valid." } });
      renderForm();
      await waitFor(() => expect(screen.getByRole("button", { name: "Verify" })).not.toBeDisabled());
      await userEvent.click(screen.getByRole("button", { name: "Can't use your authenticator?" }));
      await userEvent.click(screen.getByRole("button", { name: "Email me a code" }));
      await userEvent.type(await screen.findByLabelText("Recovery code"), "000000");
      await userEvent.click(screen.getByRole("button", { name: "Confirm" }));
      expect(await screen.findByRole("alert")).toHaveTextContent("That code is not valid.");
    });
  });
});
