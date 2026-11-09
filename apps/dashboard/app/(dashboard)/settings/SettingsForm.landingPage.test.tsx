/** Story 24.9: the Landing page row on Settings, by role. */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("./actions", () => ({
  connectPaymentProvider: vi.fn(),
  disconnectPaymentProvider: vi.fn(),
  regenerateQrCode: vi.fn(),
  saveGymCategory: vi.fn(),
  saveGymSettings: vi.fn(),
  uploadLogo: vi.fn(),
  payNow: vi.fn(),
  saveNotificationEmail: vi.fn(),
  saveRegistrationFee: vi.fn(),
  getBillingInfo: vi.fn(),
  getGuestChargingImpact: vi.fn(),
  setGuestCharging: vi.fn(),
}));
vi.mock("@/lib/realtime/paymentStatus", () => ({ fetchSaasBillingPaymentStatus: vi.fn() }));
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }) }));
vi.mock("qrcode", () => ({ default: { toDataURL: vi.fn(async () => "data:image/png;base64,x") } }));

const INITIAL = {
  gymName: "Test Gym", logoUrl: null, primaryColor: null, timezone: "Africa/Douala", defaultLanguage: "en", country: "CM", gracePeriodDays: 3, capacity: 100,
  alertAutoDismissMinutes: 30, checkinTimeoutHours: 12, openingTime: null, closingTime: null, gymToken: "token-1", registrationFee: 0,
  chargeGuestsPerSession: false, loyaltyEnabled: false, loyaltyGuestThreshold: null, loyaltyRenewalThreshold: null, loyaltyRewardDays: null, category: "gym",
};

async function renderForm(role: string | null, landingPageState: "in_progress" | null = "in_progress") {
  const { SettingsForm } = await import("./SettingsForm");
  return render(
    <SettingsForm
      initial={INITIAL}
      initialPaymentConnection={null}
      initialBillingInfo={null}
      selectableTiers={[]}
      staffCount={0}
      role={role}
      landingPageState={landingPageState}
      landingPageUserKey="g1:m1"
    />,
  );
}

describe("the Landing page row", () => {
  it.each(["owner", "supervisor", "support"])("is rendered for %s, with the state badge and an Open link", async (role) => {
    await renderForm(role);
    const row = screen.getByTestId("landing-page-row");
    expect(row).toBeTruthy();
    expect(screen.getByTestId("page-status-badge").getAttribute("data-state")).toBe("in_progress");
    expect(screen.getByText("pageEditor.settingsRow.open").closest("a")?.getAttribute("href")).toBe("/settings/landing-page");
  });

  it.each(["manager", "receptionist", "coach", null])("is absent from the DOM for %s", async (role) => {
    await renderForm(role);
    expect(screen.queryByTestId("landing-page-row")).toBeNull();
    expect(screen.queryByText("pageEditor.settingsRow.open")).toBeNull();
  });

  it("shows an unknown label when the state could not be read", async () => {
    await renderForm("owner", null);
    expect(screen.getByText("pageEditor.statusUnknown")).toBeTruthy();
  });
});
