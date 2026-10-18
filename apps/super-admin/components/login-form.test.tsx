/** The login page tells a signed-in non-admin (and an expired session) why they are back at the form. */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { createInstance } from "i18next";

import enTranslations from "../locales/en.json";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: { signInWithPassword: vi.fn() } }) }));

import { LoginForm } from "./login-form";

function renderForm(props: { expired?: boolean; denied?: boolean }) {
  const i18n = createInstance();
  i18n.use(initReactI18next).init({ lng: "en", resources: { en: { translation: enTranslations } } });
  return render(
    <I18nextProvider i18n={i18n}>
      <LoginForm {...props} />
    </I18nextProvider>,
  );
}

describe("LoginForm notices", () => {
  it("shows nothing extra on a plain visit", () => {
    renderForm({});
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText(/session expired/i)).toBeNull();
  });
  it("shows the wrong-account notice when a non-admin was turned back", () => {
    renderForm({ denied: true });
    expect(screen.getByRole("alert")).toHaveTextContent("Wrong account credentials.");
  });
  it("shows the session-expired notice, and it wins over the wrong-account one", () => {
    renderForm({ denied: true, expired: true });
    expect(screen.getByText(/session expired/i)).toBeInTheDocument();
    expect(screen.queryByText("Wrong account credentials.")).toBeNull();
  });
});
