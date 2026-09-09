/**
 * Regression test for the nested-<form> hydration error (2026-09-09, reported
 * by smartsana from the browser console on /settings):
 *
 *   In HTML, <form> cannot be a descendant of <form>.
 *   This will cause a hydration error.
 *     at PayNowButton (components/shared/PayNowButton.tsx:216)
 *     at SettingsForm (app/(dashboard)/settings/SettingsForm.tsx:880)
 *
 * `SettingsForm` renders `<PayNowButton>` inside its main `<form>` (the
 * Billing section), and this component's Pay Now dialog contains a `<form>` of
 * its own. The HTML parser drops an inner nested form, so the server markup
 * and the client tree disagree. It only appeared for gyms whose
 * `saas_billing_status` is not `active`, since that is the only case where the
 * button renders at all -- which is why it went unnoticed.
 *
 * The fix portals the dialog to `document.body`, so it is no longer a
 * descendant of the outer form. These tests render the component inside a
 * `<form>` on purpose -- the condition that triggered the bug -- and assert
 * the dialog escapes it.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/app/(dashboard)/settings/actions", () => ({
  payNow: vi.fn(),
  payNowWithHostedCheckoutLink: vi.fn(),
}));

vi.mock("@/lib/realtime/paymentStatus", () => ({
  fetchSaasBillingPaymentStatus: vi.fn(),
}));

const TRANSLATIONS: Record<string, string> = {
  "settings.billing.payNow": "Pay Now",
  "settings.billing.payNowDialogTitle": "Pay Now",
  "settings.billing.payNowDialogBody": "Confirm the mobile-money number to charge.",
  "settings.billing.payerPhoneLabel": "Payer phone number",
  "settings.billing.tierLabel": "Plan",
  "common.cancel": "Cancel",
  "phoneInput.selectCountry": "Select country",
  "phoneInput.searchCountry": "Search country...",
  "phoneInput.noCountryFound": "No country found",
};

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => TRANSLATIONS[key] ?? key,
    i18n: { language: "en" },
  }),
}));

async function renderInsideForm() {
  const { PayNowButton } = await import("./PayNowButton");
  return render(
    <form onSubmit={(e) => e.preventDefault()} data-testid="outer-form">
      <PayNowButton initialOwnerPhone="+237699000001" selectableTiers={[]} onPaymentConfirmed={vi.fn()} />
    </form>,
  );
}

describe("PayNowButton — dialog must not nest inside the host form", () => {
  it("renders no dialog until the button is pressed", async () => {
    await renderInsideForm();

    expect(document.querySelector("dialog")).toBeNull();
  });

  it("portals the dialog out of the surrounding <form> when opened", async () => {
    const user = userEvent.setup();
    await renderInsideForm();

    await user.click(screen.getByRole("button", { name: "Pay Now" }));

    const dialog = await waitFor(() => {
      const el = document.querySelector("dialog");
      expect(el).not.toBeNull();
      return el as HTMLDialogElement;
    });

    // The actual defect: a <form> inside a <form>. `closest` walks ancestors,
    // so this is precisely the invalid nesting the browser complained about.
    expect(dialog.closest("form")).toBeNull();
    expect(dialog.parentElement).toBe(document.body);

    // ...while the dialog's own form still exists (the fix must not have been
    // achieved by simply deleting it).
    expect(dialog.querySelectorAll("form")).toHaveLength(1);
  });

  it("keeps the outer form free of any nested form", async () => {
    const user = userEvent.setup();
    const { getByTestId } = await renderInsideForm();

    await user.click(screen.getByRole("button", { name: "Pay Now" }));
    await waitFor(() => expect(document.querySelector("dialog")).not.toBeNull());

    expect(getByTestId("outer-form").querySelectorAll("form")).toHaveLength(0);
  });
});
