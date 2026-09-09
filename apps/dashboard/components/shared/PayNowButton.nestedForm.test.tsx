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
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { SelectableTier } from "@/services/billing";

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
  "settings.billing.tierKeepCurrent": "Keep current",
  "settings.billing.intervalLabel": "Billing interval",
  "settings.billing.intervalMonthly": "Monthly",
  "settings.billing.intervalAnnual": "Annual",
  "settings.billing.continueOnTara": "Continue on Tara",
  "settings.billing.payNowLoading": "Working…",
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

async function renderInsideForm(
  { onOuterSubmit, selectableTiers = [] }: { onOuterSubmit?: () => void; selectableTiers?: SelectableTier[] } = {},
) {
  const { PayNowButton } = await import("./PayNowButton");
  return render(
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onOuterSubmit?.();
      }}
      data-testid="outer-form"
    >
      <PayNowButton
        initialOwnerPhone="+237699000001"
        selectableTiers={selectableTiers}
        onPaymentConfirmed={vi.fn()}
      />
    </form>,
  );
}

/** The dialog's own submit button, scoped to avoid the trigger of the same name. */
function dialogSubmitButton(dialog: HTMLElement) {
  return within(dialog).getByRole("button", { name: "Pay Now" });
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

  /**
   * Story 1.20 review finding. Portaling fixed the *markup* but not the
   * *coupling*: React propagates events along the React tree, not the DOM
   * tree, so the dialog's submit still reached `SettingsForm`'s `onSubmit`
   * and silently ran its whole validate-and-save path. `preventDefault()`
   * does not stop propagation -- only `stopPropagation()` does. The two
   * DOM-ancestry tests above cannot see this, which is why it shipped.
   */
  it("does not fire the surrounding form's onSubmit when the dialog is submitted", async () => {
    const user = userEvent.setup();
    const { payNow } = await import("@/app/(dashboard)/settings/actions");
    vi.mocked(payNow).mockResolvedValue({ data: { paymentId: "pay-1" }, error: null });
    const onOuterSubmit = vi.fn();
    await renderInsideForm({ onOuterSubmit });

    await user.click(screen.getByRole("button", { name: "Pay Now" }));
    const dialog = await waitFor(() => screen.getByRole("dialog"));

    await user.click(dialogSubmitButton(dialog));

    await waitFor(() => expect(payNow).toHaveBeenCalled());
    expect(onOuterSubmit).not.toHaveBeenCalled();
  });

  /**
   * Story 1.20 review finding: the `selectableTiers.length > 0` branch -- the
   * tier <select> and the two-column layout -- was rewritten wholesale by the
   * re-indent and rendered by no assertion in either test file, since both
   * passed `selectableTiers={[]}`.
   */
  it("renders the tier selector inside the portaled dialog when tiers are selectable", async () => {
    const user = userEvent.setup();
    await renderInsideForm({
      selectableTiers: [
        { id: "tier-hustle", name: "Hustle", monthlyPrice: 15000, annualPrice: 150000 },
        { id: "tier-scale", name: "Scale", monthlyPrice: 30000, annualPrice: 300000 },
      ],
    });

    await user.click(screen.getByRole("button", { name: "Pay Now" }));
    const dialog = await waitFor(() => screen.getByRole("dialog"));

    const tierSelect = within(dialog).getByLabelText("Plan") as HTMLSelectElement;
    expect([...tierSelect.options].map((o) => o.textContent)).toEqual(["Keep current", "Hustle", "Scale"]);

    // The interval selector shares the branch's grid and must survive with it.
    const intervalSelect = within(dialog).getByLabelText("Billing interval") as HTMLSelectElement;
    expect([...intervalSelect.options].map((o) => o.textContent)).toEqual([
      "Keep current",
      "Monthly",
      "Annual",
    ]);

    // Still portaled, still un-nested, with the tier branch rendered.
    expect(dialog.closest("form")).toBeNull();
  });
});
