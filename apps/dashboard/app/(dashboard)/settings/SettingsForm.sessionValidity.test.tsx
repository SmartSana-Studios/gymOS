/**
 * Story 28.1: `SettingsForm` Session validity section -- role gate, own-setter save, independence from [Save Settings], the dependent
 * wording (hours from the platform value, charging-off note, loyalty note, the Charge guests helper), and the page hint.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { realT } from "@/test-utils/realT";

const saveSessionValidity = vi.fn();
const getGuestChargingImpact = vi.fn();
const saveGymSettings = vi.fn();

vi.mock("./actions", () => ({
  connectPaymentProvider: vi.fn(),
  disconnectPaymentProvider: vi.fn(),
  regenerateQrCode: vi.fn(),
  saveGymCategory: vi.fn(),
  saveSessionValidity: (...args: unknown[]) => saveSessionValidity(...args),
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

let language: "en" | "fr" = "en";
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: realT(language), i18n: { language } }),
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
  openingTime: null,
  closingTime: null,
  gymToken: "token-1",
  registrationFee: 0,
  chargeGuestsPerSession: true,
  loyaltyEnabled: false,
  loyaltyGuestThreshold: null,
  loyaltyRenewalThreshold: null,
  loyaltyRewardDays: null,
  category: "gym",
};

type Validity = { sessionValidity: "whole_day" | "single_use"; visitLimitMinutes: number };

async function renderForm(
  role: string | null = "owner",
  opts: { validity?: Validity | null; charging?: boolean; loyalty?: boolean } = {},
) {
  const { SettingsForm } = await import("./SettingsForm");
  const validity = opts.validity === undefined ? { sessionValidity: "whole_day" as const, visitLimitMinutes: 180 } : opts.validity;
  return render(
    <SettingsForm
      initial={{
        ...INITIAL_SETTINGS,
        chargeGuestsPerSession: opts.charging ?? true,
        loyaltyEnabled: opts.loyalty ?? false,
      }}
      initialPaymentConnection={null}
      initialBillingInfo={null}
      selectableTiers={[]}
      staffCount={0}
      role={role}
      sessionValidity={validity}
    />,
  );
}

const radio = (name: string) => screen.getByRole("radio", { name: new RegExp(`^${name}`) }) as HTMLInputElement;
const saveButton = () => screen.getByRole("button", { name: "Save session validity" }) as HTMLButtonElement;

describe("SettingsForm session validity section", () => {
  beforeEach(() => {
    language = "en";
    saveSessionValidity.mockReset().mockResolvedValue({ data: { ok: true }, error: null });
    saveGymSettings.mockReset().mockResolvedValue({ data: { ok: true }, error: null, warning: null });
  });

  it.each(["owner", "supervisor", "support"])("renders for %s with Whole day selected and both descriptions", async (role) => {
    await renderForm(role);
    expect(screen.getByRole("heading", { name: "Session validity" })).toBeTruthy();
    expect(radio("Whole day").checked).toBe(true);
    expect(radio("Single use").checked).toBe(false);
    expect(screen.getByText("A paid session covers every check-in until the end of the day.")).toBeTruthy();
    expect(
      screen.getByText("A paid session covers one visit. A visit ends at check-out, or 3 hours after check-in, whichever comes first."),
    ).toBeTruthy();
    expect(screen.getByText("A class attended during an open visit uses that visit's session. Otherwise it uses its own session.")).toBeTruthy();
    expect(screen.getByText(/^The change applies to check-ins from now on\./)).toBeTruthy();
  });

  it.each(["manager", "receptionist", "coach", null])("is absent from the DOM for %s, even when handed a value", async (role) => {
    await renderForm(role);
    expect(screen.queryByRole("heading", { name: "Session validity" })).toBeNull();
    expect(screen.queryByRole("radio")).toBeNull();
    expect(screen.queryByRole("button", { name: "Save session validity" })).toBeNull();
  });

  it("is absent when the read returned nothing", async () => {
    await renderForm("owner", { validity: null });
    expect(screen.queryByRole("radio")).toBeNull();
  });

  it("shows minutes as hours, one decimal only when not a whole hour", async () => {
    await renderForm("owner", { validity: { sessionValidity: "whole_day", visitLimitMinutes: 90 } });
    expect(screen.getByText(/or 1\.5 hours after check-in/)).toBeTruthy();
  });

  it("FR: the limit and the labels are in French", async () => {
    language = "fr";
    await renderForm("owner", { validity: { sessionValidity: "whole_day", visitLimitMinutes: 240 } });
    expect(screen.getByText(/ou 4 heures après l'arrivée/)).toBeTruthy();
    expect(screen.getByRole("radio", { name: /^Toute la journée/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Enregistrer la validité de la séance" })).toBeTruthy();
  });

  it("enables Save only while the choice differs from the saved value", async () => {
    await renderForm();
    expect(saveButton().disabled).toBe(true);
    fireEvent.click(radio("Single use"));
    expect(saveButton().disabled).toBe(false);
    fireEvent.click(radio("Whole day"));
    expect(saveButton().disabled).toBe(true);
  });

  it("saves through its own action only, with no dialog, toasts, and disables again", async () => {
    const user = userEvent.setup();
    await renderForm();
    fireEvent.click(radio("Single use"));
    await user.click(saveButton());
    await waitFor(() => expect(saveSessionValidity).toHaveBeenCalledWith("single_use"));
    expect(await screen.findByText("Session validity saved.")).toBeTruthy();
    expect(saveSessionValidity).toHaveBeenCalledTimes(1);
    expect(saveGymSettings).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(radio("Single use").checked).toBe(true);
    expect(saveButton().disabled).toBe(true);
  });

  it("shows a refusal inline and leaves the radio where the user put it", async () => {
    const user = userEvent.setup();
    saveSessionValidity.mockResolvedValue({
      data: null,
      error: { code: "unknown", message: "Couldn't save session validity. Try again." },
    });
    await renderForm();
    fireEvent.click(radio("Single use"));
    await user.click(saveButton());
    expect((await screen.findByRole("alert")).textContent).toBe("Couldn't save session validity. Try again.");
    expect(radio("Single use").checked).toBe(true);
    expect(saveButton().disabled).toBe(false);
  });

  it("shows the fixed message when the action throws", async () => {
    const user = userEvent.setup();
    saveSessionValidity.mockRejectedValue(new Error("network"));
    await renderForm();
    fireEvent.click(radio("Single use"));
    await user.click(saveButton());
    expect((await screen.findByRole("alert")).textContent).toBe("Couldn't save session validity. Try again.");
  });

  it("with charging off it stays editable and shows the note", async () => {
    await renderForm("owner", { charging: false });
    expect(screen.getByText('Takes effect when "Charge guests per session" is on.')).toBeTruthy();
    expect(radio("Single use").disabled).toBe(false);
  });

  it("with charging on there is no such note", async () => {
    await renderForm("owner", { charging: true });
    expect(screen.queryByText(/^Takes effect when/)).toBeNull();
  });

  it("shows the loyalty note only when loyalty is on and the chosen option is Single use", async () => {
    await renderForm("owner", { loyalty: true });
    const note = "Single use earns loyalty stamps faster: one per paid session. Check your loyalty setting.";
    expect(screen.queryByText(note)).toBeNull();
    fireEvent.click(radio("Single use"));
    expect(screen.getByText(note)).toBeTruthy();
    fireEvent.click(radio("Whole day"));
    expect(screen.queryByText(note)).toBeNull();
  });

  it("never shows the loyalty note while loyalty is off", async () => {
    await renderForm("owner", { loyalty: false });
    fireEvent.click(radio("Single use"));
    expect(screen.queryByText(/earns loyalty stamps faster/)).toBeNull();
  });

  it("the Charge guests helper follows the saved value, not the unsaved choice", async () => {
    const user = userEvent.setup();
    await renderForm();
    expect(screen.getByText(/One session covers the whole day\./)).toBeTruthy();
    fireEvent.click(radio("Single use"));
    expect(screen.getByText(/One session covers the whole day\./)).toBeTruthy();
    await user.click(saveButton());
    await screen.findByText("Session validity saved.");
    expect(screen.getByText(/One session covers one visit\./)).toBeTruthy();
    expect(screen.queryByText(/One session covers the whole day\./)).toBeNull();
  });

  it("the page hint ends with Session validity and names no Gym challenge", async () => {
    await renderForm();
    const hint = screen.getByText(/^Save applies changes across every section below/);
    expect(hint.textContent).toMatch(/Landing page and Session validity, which save on their own\.$/);
    expect(hint.textContent).not.toMatch(/challenge/i);
  });

  it("the general save payload never contains session_validity, even after a change", async () => {
    const user = userEvent.setup();
    await renderForm();
    fireEvent.click(radio("Single use"));
    await user.click(screen.getByRole("button", { name: "Save Settings" }));
    await waitFor(() => expect(saveGymSettings).toHaveBeenCalledTimes(1));
    const payload = JSON.stringify(saveGymSettings.mock.calls[0][0]).toLowerCase();
    expect(payload).not.toContain("session_validity");
    expect(payload).not.toContain("sessionvalidity");
    expect(payload).not.toContain("single_use");
    expect(saveSessionValidity).not.toHaveBeenCalled();
    expect(radio("Single use").checked).toBe(true);
  });
});
