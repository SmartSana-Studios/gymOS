/**
 * Opening hours in Settings (Attendance section): pre-fill, saved through the main form with the other settings, blank
 * means "not set" (quiet-gym alerts then use 06:00-22:00), and an invalid time is refused before any save.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const saveGymSettings = vi.fn();

vi.mock("./actions", () => ({
  saveGymCategory: vi.fn(),
  connectPaymentProvider: vi.fn(),
  disconnectPaymentProvider: vi.fn(),
  regenerateQrCode: vi.fn(),
  saveGymSettings: (...args: unknown[]) => saveGymSettings(...args),
  uploadLogo: vi.fn(),
  payNow: vi.fn(),
  saveNotificationEmail: vi.fn(),
  saveRegistrationFee: vi.fn(),
  getBillingInfo: vi.fn(),
}));
vi.mock("@/lib/realtime/paymentStatus", () => ({ fetchSaasBillingPaymentStatus: vi.fn() }));

const TRANSLATIONS: Record<string, string> = {
  "settings.fields.openingTime": "Opens",
  "settings.fields.closingTime": "Closes",
  "settings.saveButton": "Save settings",
};
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => TRANSLATIONS[key] ?? key, i18n: { language: "en" } }),
}));
vi.mock("qrcode", () => ({ default: { toDataURL: vi.fn(async () => "data:image/png;base64,x") } }));

const BASE = {
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
  openingTime: null as string | null,
  closingTime: null as string | null,
  gymToken: "token-1",
  registrationFee: 0,
  chargeGuestsPerSession: false,
  loyaltyEnabled: false,
  loyaltyGuestThreshold: null,
  loyaltyRenewalThreshold: null,
  loyaltyRewardDays: null,
  category: "gym",
};

async function renderForm(overrides: Partial<typeof BASE> = {}) {
  const { SettingsForm } = await import("./SettingsForm");
  return render(
    <SettingsForm
      initial={{ ...BASE, ...overrides }}
      initialPaymentConnection={null}
      initialBillingInfo={null}
      selectableTiers={[]}
      staffCount={0}
    />,
  );
}

describe("SettingsForm opening hours", () => {
  beforeEach(() => saveGymSettings.mockReset());

  it("pre-fills the saved hours", async () => {
    await renderForm({ openingTime: "06:00", closingTime: "22:00" });
    expect((screen.getByLabelText("Opens") as HTMLInputElement).value).toBe("06:00");
    expect((screen.getByLabelText("Closes") as HTMLInputElement).value).toBe("22:00");
  });

  it("saves the typed hours with the other settings", async () => {
    saveGymSettings.mockResolvedValue({ error: null, warning: null });
    await renderForm();
    fireEvent.change(screen.getByLabelText("Opens"), { target: { value: "06:00" } });
    fireEvent.change(screen.getByLabelText("Closes"), { target: { value: "22:00" } });
    await userEvent.setup().click(screen.getByRole("button", { name: "Save settings" }));
    await waitFor(() => expect(saveGymSettings).toHaveBeenCalled());
    expect(saveGymSettings.mock.calls[0][0]).toMatchObject({ openingTime: "06:00", closingTime: "22:00" });
  });

  it("sends null for hours left empty", async () => {
    saveGymSettings.mockResolvedValue({ error: null, warning: null });
    await renderForm();
    await userEvent.setup().click(screen.getByRole("button", { name: "Save settings" }));
    await waitFor(() => expect(saveGymSettings).toHaveBeenCalled());
    expect(saveGymSettings.mock.calls[0][0]).toMatchObject({ openingTime: null, closingTime: null });
  });
});
