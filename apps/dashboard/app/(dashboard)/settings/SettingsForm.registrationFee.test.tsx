/**
 * Story 18.1: component-level tests for `SettingsForm`'s registration-fee
 * field -- pre-fill, its own Save button (the fee is saved through its own
 * RPC, never the main form's submit), client-side validation, and error
 * display. Mirrors `SettingsForm.billing.test.tsx`'s pattern.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const saveRegistrationFee = vi.fn();
const saveGymSettings = vi.fn();

vi.mock("./actions", () => ({
  connectPaymentProvider: vi.fn(),
  disconnectPaymentProvider: vi.fn(),
  regenerateQrCode: vi.fn(),
  saveGymSettings: (...args: unknown[]) => saveGymSettings(...args),
  uploadLogo: vi.fn(),
  payNow: vi.fn(),
  saveNotificationEmail: vi.fn(),
  saveRegistrationFee: (...args: unknown[]) => saveRegistrationFee(...args),
  getBillingInfo: vi.fn(),
}));

vi.mock("@/lib/realtime/paymentStatus", () => ({
  fetchSaasBillingPaymentStatus: vi.fn(),
}));

const TRANSLATIONS: Record<string, string> = {
  "settings.fields.registrationFee": "Registration fee",
  "settings.fields.registrationFeeHint": "0 means no registration fee",
  "settings.fields.registrationFeeUnit": "XAF",
  "settings.fields.registrationFeeSave": "Save fee",
  "settings.fields.registrationFeeSavedToast": "Registration fee saved.",
  "settings.errors.registrationFeeInvalid": "Enter a whole amount of 0 or more",
  "settings.errors.registrationFeeSaveFailed": "Could not save the registration fee",
  "common.saving": "Saving…",
};

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => TRANSLATIONS[key] ?? key,
    i18n: { language: "en" },
  }),
}));

vi.mock("qrcode", () => ({ default: { toDataURL: vi.fn(async () => "data:image/png;base64,x") } }));

const INITIAL_SETTINGS = {
  gymName: "Test Gym",
  logoUrl: null,
  primaryColor: null,
  timezone: "Africa/Douala",
  defaultLanguage: "en",
  country: "CM",
  gracePeriodDays: 3,
  capacity: 100,
  alertAutoDismissMinutes: 30,
  checkinTimeoutHours: 12,
  gymToken: "token-1",
  registrationFee: 2500,
};

async function renderForm() {
  const { SettingsForm } = await import("./SettingsForm");
  return render(
    <SettingsForm
      initial={INITIAL_SETTINGS}
      initialPaymentConnection={null}
      initialBillingInfo={null}
      selectableTiers={[]}
      staffCount={0}
    />,
  );
}

describe("SettingsForm registration fee field", () => {
  beforeEach(() => {
    saveRegistrationFee.mockReset();
    saveGymSettings.mockReset();
  });

  it("pre-fills the current fee and shows the helper text", async () => {
    await renderForm();

    expect((screen.getByLabelText("Registration fee") as HTMLInputElement).value).toBe("2500");
    expect(screen.getByText("0 means no registration fee")).toBeVisible();
  });

  it("saves the typed amount through its own action, not the main form's, and confirms with a toast", async () => {
    const user = userEvent.setup();
    saveRegistrationFee.mockResolvedValue({ data: { ok: true }, error: null });
    await renderForm();

    const input = screen.getByLabelText("Registration fee");
    await user.clear(input);
    await user.type(input, "5000");
    await user.click(screen.getByRole("button", { name: "Save fee" }));

    await waitFor(() => expect(saveRegistrationFee).toHaveBeenCalledWith(5000));
    await waitFor(() => expect(screen.getByText("Registration fee saved.")).toBeVisible());
    expect(saveGymSettings).not.toHaveBeenCalled();
  });

  it("saves 0 (turning the fee off)", async () => {
    const user = userEvent.setup();
    saveRegistrationFee.mockResolvedValue({ data: { ok: true }, error: null });
    await renderForm();

    const input = screen.getByLabelText("Registration fee");
    await user.clear(input);
    await user.type(input, "0");
    await user.click(screen.getByRole("button", { name: "Save fee" }));

    await waitFor(() => expect(saveRegistrationFee).toHaveBeenCalledWith(0));
  });

  it.each([["", "blank"], ["-5", "negative"], ["12.5", "fractional"]])(
    "a %j (%s) amount shows a validation error and never calls the action",
    async (value) => {
      const user = userEvent.setup();
      await renderForm();

      const input = screen.getByLabelText("Registration fee");
      await user.clear(input);
      if (value !== "") await user.type(input, value);
      await user.click(screen.getByRole("button", { name: "Save fee" }));

      await waitFor(() => expect(screen.getByText("Enter a whole amount of 0 or more")).toBeVisible());
      expect(saveRegistrationFee).not.toHaveBeenCalled();
    },
  );

  it("shows the action's error and no success toast when the save fails", async () => {
    const user = userEvent.setup();
    saveRegistrationFee.mockResolvedValue({ data: null, error: { code: "unknown", message: "permission denied" } });
    await renderForm();

    await user.click(screen.getByRole("button", { name: "Save fee" }));

    await waitFor(() => expect(screen.getByText("permission denied")).toBeVisible());
    expect(screen.queryByText("Registration fee saved.")).not.toBeInTheDocument();
  });

  it("pressing Enter in the field saves the fee instead of submitting the main settings form", async () => {
    const user = userEvent.setup();
    saveRegistrationFee.mockResolvedValue({ data: { ok: true }, error: null });
    await renderForm();

    const input = screen.getByLabelText("Registration fee");
    await user.clear(input);
    await user.type(input, "3000{Enter}");

    await waitFor(() => expect(saveRegistrationFee).toHaveBeenCalledWith(3000));
    expect(saveGymSettings).not.toHaveBeenCalled();
  });
});
