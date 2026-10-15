/**
 * Story 21.2: `SettingsForm` category field -- role gate, own-setter save,
 * independence from [Save Settings].
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const saveGymCategory = vi.fn();
const getGuestChargingImpact = vi.fn();
const saveGymSettings = vi.fn();

vi.mock("./actions", () => ({
  connectPaymentProvider: vi.fn(),
  disconnectPaymentProvider: vi.fn(),
  regenerateQrCode: vi.fn(),
  saveGymCategory: (...args: unknown[]) => saveGymCategory(...args),
  saveGymSettings: (...args: unknown[]) => saveGymSettings(...args),
  uploadLogo: vi.fn(),
  payNow: vi.fn(),
  saveNotificationEmail: vi.fn(),
  saveRegistrationFee: vi.fn(),
  getBillingInfo: vi.fn(),
  getGuestChargingImpact: (...args: unknown[]) => getGuestChargingImpact(...args),
  setGuestCharging: vi.fn(),
}));

vi.mock("@/lib/realtime/paymentStatus", () => ({
  fetchSaasBillingPaymentStatus: vi.fn(),
}));

const TRANSLATIONS: Record<string, string> = {
  "settings.category.label": "Category",
  "settings.category.helper": "Describes your business. It doesn't change how GymOS works.",
  "settings.category.save": "Save category",
  "settings.category.savedToast": "Category saved.",
  "settings.category.saveFailed": "Couldn't save the category. Try again.",
  "settings.saveButton": "Save Settings",
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
  registrationFee: 0,
  chargeGuestsPerSession: false,
  loyaltyEnabled: false,
  loyaltyGuestThreshold: null,
  loyaltyRenewalThreshold: null,
  loyaltyRewardDays: null,
  category: "gym",
};

async function renderForm(role: string | null = "owner") {
  const { SettingsForm } = await import("./SettingsForm");
  return render(
    <SettingsForm
      initial={INITIAL_SETTINGS}
      initialPaymentConnection={null}
      initialBillingInfo={null}
      selectableTiers={[]}
      staffCount={0}
      role={role}
    />,
  );
}

const field = () => screen.getByLabelText("Category") as HTMLSelectElement;
const saveButton = () => screen.getByRole("button", { name: "Save category" });

describe("SettingsForm category field", () => {
  beforeEach(() => {
    saveGymCategory.mockReset().mockResolvedValue({ data: { ok: true }, error: null });
    saveGymSettings.mockReset().mockResolvedValue({ data: { ok: true }, error: null, warning: null });
  });

  it.each(["owner", "supervisor"])("renders the five options and helper for %s", async (role) => {
    await renderForm(role);
    expect(field().value).toBe("gym");
    expect(Array.from(field().options).map((o) => o.value)).toEqual([
      "gym",
      "pilates_studio",
      "yoga_studio",
      "fitness_center",
      "other",
    ]);
    expect(screen.getByText("Describes your business. It doesn't change how GymOS works.")).toBeTruthy();
  });

  it.each(["manager", "receptionist", "coach", null])("is absent from the DOM for %s", async (role) => {
    await renderForm(role);
    expect(screen.queryByLabelText("Category")).toBeNull();
    expect(screen.queryByRole("button", { name: "Save category" })).toBeNull();
  });

  it("disables Save category until the value changes, and opens no free text for Other", async () => {
    await renderForm();
    expect((saveButton() as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(field(), { target: { value: "other" } });
    expect((saveButton() as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByRole("textbox", { name: /other/i })).toBeNull();
    fireEvent.change(field(), { target: { value: "gym" } });
    expect((saveButton() as HTMLButtonElement).disabled).toBe(true);
  });

  it("saves through its own action, toasts, and disables again", async () => {
    const user = userEvent.setup();
    await renderForm();
    fireEvent.change(field(), { target: { value: "yoga_studio" } });
    await user.click(saveButton());
    await waitFor(() => expect(saveGymCategory).toHaveBeenCalledWith("yoga_studio"));
    expect(await screen.findByText("Category saved.")).toBeTruthy();
    expect(field().value).toBe("yoga_studio");
    expect((saveButton() as HTMLButtonElement).disabled).toBe(true);
    expect(saveGymSettings).not.toHaveBeenCalled();
  });

  it("shows a refusal inline and keeps the choice savable", async () => {
    const user = userEvent.setup();
    saveGymCategory.mockResolvedValue({ data: null, error: { code: "unknown", message: "Couldn't save the category. Try again." } });
    await renderForm();
    fireEvent.change(field(), { target: { value: "other" } });
    await user.click(saveButton());
    expect((await screen.findByRole("alert")).textContent).toBe("Couldn't save the category. Try again.");
    expect((saveButton() as HTMLButtonElement).disabled).toBe(false);
  });

  it("shows the fixed message when the action throws", async () => {
    const user = userEvent.setup();
    saveGymCategory.mockRejectedValue(new Error("network"));
    await renderForm();
    fireEvent.change(field(), { target: { value: "other" } });
    await user.click(saveButton());
    expect((await screen.findByRole("alert")).textContent).toBe("Couldn't save the category. Try again.");
  });

  it("keeps an unsaved category through [Save Settings] and never sends it", async () => {
    const user = userEvent.setup();
    await renderForm();
    fireEvent.change(field(), { target: { value: "fitness_center" } });
    await user.click(screen.getByRole("button", { name: "Save Settings" }));
    await waitFor(() => expect(saveGymSettings).toHaveBeenCalled());
    expect(JSON.stringify(saveGymSettings.mock.calls[0])).not.toContain("fitness_center");
    expect(field().value).toBe("fitness_center");
    expect(saveGymCategory).not.toHaveBeenCalled();
  });
});
