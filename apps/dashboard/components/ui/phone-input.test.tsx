/**
 * Story 16.1 (AC #15): component-level tests for the new shared PhoneInput
 * primitive -- country selection, calling-code auto-prefix on selection, and
 * correct E.164 emission via onChange. Renders the real Popover/Command/
 * react-i18next stack (no react-i18next mock, matching AC #14's requirement
 * that PhoneInput's own strings come from real locale files) since this is
 * the first component in the app to exercise those two new primitives.
 */
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { createInstance } from "i18next";

import enTranslations from "../../locales/en.json";
import { PhoneInput } from "./phone-input";

function createTestI18n() {
  const instance = createInstance();
  instance.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: { en: { translation: enTranslations } },
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  });
  return instance;
}

function renderPhoneInput(props: Partial<React.ComponentProps<typeof PhoneInput>> = {}) {
  const onChange = vi.fn();
  render(
    <I18nextProvider i18n={createTestI18n()}>
      <label htmlFor="testPhone">{"Phone"}</label>
      <PhoneInput id="testPhone" value={null} onChange={onChange} {...props} />
    </I18nextProvider>,
  );
  return { onChange };
}

describe("PhoneInput (Story 16.1)", () => {
  it("AC #8: defaults to Cameroon (+237) with an empty national number when value is null", () => {
    renderPhoneInput({ value: null });

    expect(screen.getByRole("combobox", { name: /select country/i })).toHaveTextContent("+237");
    expect(screen.getByLabelText("Phone")).toHaveValue("");
  });

  it("AC #8: falls back to the default Cameroon selection for a non-E.164 legacy value instead of rendering broken state", () => {
    renderPhoneInput({ value: "680811041" });

    expect(screen.getByRole("combobox", { name: /select country/i })).toHaveTextContent("+237");
    expect(screen.getByLabelText("Phone")).toHaveValue("");
  });

  it("parses an existing E.164 value into its country and national number", () => {
    renderPhoneInput({ value: "+237680811041" });

    expect(screen.getByRole("combobox", { name: /select country/i })).toHaveTextContent("+237");
    expect(screen.getByLabelText("Phone")).toHaveValue("680811041");
  });

  it("AC #1: emits a valid E.164 string via onChange once the national number is a valid subscriber number", async () => {
    const user = userEvent.setup();
    const { onChange } = renderPhoneInput({ value: null });

    await user.type(screen.getByLabelText("Phone"), "680811041");

    expect(onChange).toHaveBeenLastCalledWith("+237680811041");
  });

  it("AC #1: emits null while the national number does not yet parse as a valid phone number", async () => {
    const user = userEvent.setup();
    const { onChange } = renderPhoneInput({ value: null });

    await user.type(screen.getByLabelText("Phone"), "1");

    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it("AC #1: country selection auto-prefixes the new calling code and re-emits E.164 for the already-typed national number", async () => {
    const user = userEvent.setup();
    const { onChange } = renderPhoneInput({ value: null });

    await user.type(screen.getByLabelText("Phone"), "612345678");
    onChange.mockClear();

    await user.click(screen.getByRole("combobox", { name: /select country/i }));
    await user.type(screen.getByPlaceholderText(/search country/i), "France");
    await user.click(await screen.findByText("France"));

    expect(screen.getByRole("combobox", { name: /select country/i })).toHaveTextContent("+33");
    await waitFor(() => expect(onChange).toHaveBeenCalledWith("+33612345678"));
  });

  it("restricts the country list to TARAMONEY_SUPPORTED_COUNTRIES when countries='tara-money'", async () => {
    const user = userEvent.setup();
    renderPhoneInput({ value: null, countries: "tara-money" });

    await user.click(screen.getByRole("combobox", { name: /select country/i }));

    expect(screen.getByText("Cameroon")).toBeInTheDocument();
    expect(screen.queryByText("France")).not.toBeInTheDocument();
  });

  it("bug fix: selecting a country before typing any digits doesn't snap back to the default (MemberModal's `+237`-seeded, `value ?? \"\"` round-trip pattern)", async () => {
    // Reproduces every real call site exactly: a controlled parent whose
    // form state starts as a non-empty placeholder (MemberModal's
    // DEFAULT_PHONE_PREFIX) and coerces PhoneInput's `null` emission back to
    // `""` before feeding it back in as `value` -- the mismatch between the
    // `null` PhoneInput itself tracked and the `""` it receives back is what
    // caused the just-picked country to be discarded (confirmed live in a
    // real browser against MemberModal before this fix).
    function ControlledWrapper() {
      const [phone, setPhone] = useState<string>("+237");
      return <PhoneInput id="testPhone" value={phone} onChange={(v) => setPhone(v ?? "")} />;
    }
    const user = userEvent.setup();
    render(
      <I18nextProvider i18n={createTestI18n()}>
        <label htmlFor="testPhone">{"Phone"}</label>
        <ControlledWrapper />
      </I18nextProvider>,
    );

    await user.click(screen.getByRole("combobox", { name: /select country/i }));
    await user.type(screen.getByPlaceholderText(/search country/i), "Ghana");
    await user.click(await screen.findByText("Ghana"));

    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: /select country/i })).toHaveTextContent("+233"),
    );
    expect(screen.getByLabelText("Phone")).toHaveValue("");
  });
});
