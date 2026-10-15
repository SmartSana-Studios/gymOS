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

vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));
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
    await waitFor(() => expect(screen.getByRole("button")).not.toBeDisabled());
    await userEvent.type(screen.getByLabelText("6-digit code"), "123456");
    await userEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/gyms"));
    expect(challengeAndVerify).toHaveBeenCalledWith({ factorId: "f1", code: "123456" });
  });

  it("with two factors it falls through to the one whose device answers", async () => {
    listFactors.mockResolvedValue({ data: { totp: [{ id: "f1" }, { id: "f2" }] }, error: null });
    challengeAndVerify
      .mockResolvedValueOnce({ data: null, error: { message: "bad" } })
      .mockResolvedValueOnce({ data: {}, error: null });
    renderForm();
    await waitFor(() => expect(screen.getByRole("button")).not.toBeDisabled());
    await userEvent.type(screen.getByLabelText("6-digit code"), "123456");
    await userEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/gyms"));
    expect(challengeAndVerify).toHaveBeenLastCalledWith({ factorId: "f2", code: "123456" });
  });

  it("a wrong code shows an error and stays", async () => {
    challengeAndVerify.mockResolvedValue({ data: null, error: { message: "bad" } });
    renderForm();
    await waitFor(() => expect(screen.getByRole("button")).not.toBeDisabled());
    await userEvent.type(screen.getByLabelText("6-digit code"), "000000");
    await userEvent.click(screen.getByRole("button"));
    expect(await screen.findByText(enTranslations.mfaPrompt.invalidCode)).toBeTruthy();
    expect(push).not.toHaveBeenCalled();
  });

  it("with no verified factor it shows the message and never enrolls", async () => {
    listFactors.mockResolvedValue({ data: { totp: [] }, error: null });
    renderForm();
    expect(await screen.findByText(enTranslations.mfaPrompt.noFactor)).toBeTruthy();
    expect(challengeAndVerify).not.toHaveBeenCalled();
  });
});
