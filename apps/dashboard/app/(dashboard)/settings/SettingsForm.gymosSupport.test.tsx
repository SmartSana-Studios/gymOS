/**
 * Story 23.3: `SettingsForm` GymOS Support switch -- Owner only.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("./actions", () => ({
  saveGymCategory: vi.fn(),
  connectPaymentProvider: vi.fn(),
  disconnectPaymentProvider: vi.fn(),
  regenerateQrCode: vi.fn(),
  saveGymSettings: vi.fn(),
  uploadLogo: vi.fn(),
  payNow: vi.fn(),
  saveNotificationEmail: vi.fn(),
  saveRegistrationFee: vi.fn(),
  getBillingInfo: vi.fn(),
  getGuestChargingImpact: vi.fn(),
  setGuestCharging: vi.fn(),
  saveAllowGymosSupport: vi.fn(),
  loadGymosSupportStatus: vi.fn(),
}));
vi.mock("@/lib/realtime/paymentStatus", () => ({ fetchSaasBillingPaymentStatus: vi.fn() }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
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
  registrationFee: 0,
  chargeGuestsPerSession: false,
  loyaltyEnabled: false,
  loyaltyGuestThreshold: null,
  loyaltyRenewalThreshold: null,
  loyaltyRewardDays: null,
  category: "gym",
};

const STATUS = { allowed: true, state: "none" as const, lastActedAt: null };

async function renderForm(role: string) {
  const { SettingsForm } = await import("./SettingsForm");
  return render(
    <SettingsForm
      initial={INITIAL_SETTINGS}
      initialPaymentConnection={null}
      initialBillingInfo={null}
      selectableTiers={[]}
      staffCount={0}
      role={role}
      gymosSupportStatus={STATUS}
    />,
  );
}

describe("SettingsForm GymOS Support switch", () => {
  it("renders for an owner", async () => {
    await renderForm("owner");
    expect(screen.getByRole("switch", { name: "settings.gymosSupport.label" })).toBeTruthy();
  });

  it("is absent for a supervisor even with a status", async () => {
    await renderForm("supervisor");
    expect(screen.queryByText("settings.gymosSupport.label")).toBeNull();
  });
});
