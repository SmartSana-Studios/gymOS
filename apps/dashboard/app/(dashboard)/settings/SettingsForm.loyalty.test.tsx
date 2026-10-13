/**
 * Story 20.5: `SettingsForm`'s Loyalty program section -- role gate, ranges,
 * live readout, notes, own save, and exclusion from [Save Settings].
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const saveLoyaltyProgram = vi.fn();
const saveGymSettings = vi.fn();

vi.mock("./actions", () => ({
  connectPaymentProvider: vi.fn(),
  disconnectPaymentProvider: vi.fn(),
  regenerateQrCode: vi.fn(),
  saveGymSettings: (...args: unknown[]) => saveGymSettings(...args),
  saveLoyaltyProgram: (...args: unknown[]) => saveLoyaltyProgram(...args),
  uploadLogo: vi.fn(),
  payNow: vi.fn(),
  saveNotificationEmail: vi.fn(),
  saveRegistrationFee: vi.fn(),
  getBillingInfo: vi.fn(),
  getGuestChargingImpact: vi.fn(),
  setGuestCharging: vi.fn(),
}));

vi.mock("@/lib/realtime/paymentStatus", () => ({
  fetchSaasBillingPaymentStatus: vi.fn(),
}));

const TRANSLATIONS: Record<string, string> = {
  "settings.loyalty.label": "Loyalty program",
  "settings.loyalty.guestReadout": "1 free session per {{n}} paid ≈ {{percent}}%",
  "settings.loyalty.guestReadoutSr": "SR 1 free session per {{n}} paid, about {{percent}}%",
  "settings.loyalty.subscriberReadout": "{{r}} days per {{k}} renewals of a {{d}}-day plan ({{plan}}) ≈ {{percent}}%",
  "settings.loyalty.subscriberReadoutSr": "SR {{r}} days per {{k}} renewals of a {{d}}-day plan ({{plan}}), about {{percent}}%",
  "settings.loyalty.chargingOffInfo": "Guests earn nothing while Charge guests per session is off.",
  "settings.loyalty.loweredNote": "Members already at or above the new number earn one reward.",
  "settings.loyalty.offNote": "No new stamps are earned while the program is off.",
  "settings.loyalty.saveButton": "Save loyalty program",
  "settings.loyalty.savedToast": "Loyalty program saved.",
  "settings.loyalty.saveFailed": "Couldn't save the loyalty program. Try again.",
  "settings.loyalty.errors.n": "Enter a whole number from 2 to 50",
  "settings.loyalty.errors.k": "Enter a whole number from 3 to 24",
  "settings.loyalty.errors.r": "Enter a whole number from 1 to 30",
  "settings.loyalty.guestsLabel": "Guests",
  "settings.loyalty.rewardDaysAria": "Free days per reward",
  "settings.loyalty.renewalsAria": "On-time renewals per reward",
  "settings.guestCharging.label": "Charge guests per session",
  "settings.guestCharging.offStamps": "Guests stop earning loyalty stamps.",
  "settings.saveButton": "Save Settings",
  "common.saving": "Saving…",
};

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      let text = TRANSLATIONS[key] ?? key;
      for (const [name, value] of Object.entries(opts ?? {})) text = text.replaceAll(`{{${name}}}`, String(value));
      return text;
    },
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
  chargeGuestsPerSession: true,
  loyaltyEnabled: false,
  loyaltyGuestThreshold: null as number | null,
  loyaltyRenewalThreshold: null as number | null,
  loyaltyRewardDays: null as number | null,
};

async function renderForm(
  props: {
    role?: string | null;
    settings?: Partial<typeof INITIAL_SETTINGS>;
    plans?: { name: string; durationDays: number }[];
  } = {},
) {
  const { SettingsForm } = await import("./SettingsForm");
  return render(
    <SettingsForm
      initial={{ ...INITIAL_SETTINGS, ...props.settings }}
      initialPaymentConnection={null}
      initialBillingInfo={null}
      selectableTiers={[]}
      staffCount={0}
      role={props.role === undefined ? "owner" : props.role}
      loyaltyPlans={props.plans ?? [{ name: "Monthly", durationDays: 30 }]}
    />,
  );
}

const loyaltySwitch = () => screen.getByRole("switch", { name: "Loyalty program" });
const nInput = () => screen.getByLabelText("Guests");
const kInput = () => screen.getByLabelText("On-time renewals per reward");
const rInput = () => screen.getByLabelText("Free days per reward");
const saveButton = () => screen.getByRole("button", { name: "Save loyalty program" });

function setValue(el: HTMLElement, value: string) {
  fireEvent.change(el, { target: { value } });
}

describe("SettingsForm loyalty program", () => {
  beforeEach(() => {
    saveLoyaltyProgram.mockReset().mockResolvedValue({ data: { ok: true }, error: null });
    saveGymSettings.mockReset().mockResolvedValue({ data: { ok: true }, error: null, warning: null });
  });

  it.each(["owner", "supervisor"])("renders for %s", async (role) => {
    await renderForm({ role });
    expect(loyaltySwitch()).toHaveAttribute("aria-checked", "false");
  });

  it.each(["manager", "receptionist", "coach", null])("is absent for role %s", async (role) => {
    await renderForm({ role });
    expect(screen.queryByRole("switch", { name: "Loyalty program" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save loyalty program" })).not.toBeInTheDocument();
  });

  it("disables the inputs while off, keeping their stored values", async () => {
    await renderForm({
      settings: { loyaltyGuestThreshold: 5, loyaltyRenewalThreshold: 4, loyaltyRewardDays: 10 },
    });
    expect(nInput()).toBeDisabled();
    expect(nInput()).toHaveValue(5);
    expect(kInput()).toHaveValue(4);
    expect(rInput()).toHaveValue(10);
  });

  it("enabling sends all four values, toasts, and never calls saveGymSettings", async () => {
    const user = userEvent.setup();
    await renderForm();
    await user.click(loyaltySwitch());
    setValue(nInput(), "5");
    setValue(kInput(), "3");
    setValue(rInput(), "30");
    await user.click(saveButton());

    await waitFor(() => expect(saveLoyaltyProgram).toHaveBeenCalledWith({ enabled: true, n: 5, k: 3, r: 30 }));
    expect(await screen.findByText("Loyalty program saved.")).toBeInTheDocument();
    expect(saveGymSettings).not.toHaveBeenCalled();
  });

  it("[Save Settings] does not send loyalty and keeps unsaved loyalty edits", async () => {
    const user = userEvent.setup();
    await renderForm();
    await user.click(loyaltySwitch());
    setValue(nInput(), "7");
    await user.click(screen.getByRole("button", { name: "Save Settings" }));

    await waitFor(() => expect(saveGymSettings).toHaveBeenCalled());
    expect(JSON.stringify(saveGymSettings.mock.calls[0])).not.toMatch(/loyalty/i);
    expect(saveLoyaltyProgram).not.toHaveBeenCalled();
    expect(nInput()).toHaveValue(7);
  });

  it("disabling an enabled program sends the stored values with enabled false", async () => {
    const user = userEvent.setup();
    await renderForm({
      settings: {
        loyaltyEnabled: true,
        loyaltyGuestThreshold: 5,
        loyaltyRenewalThreshold: 3,
        loyaltyRewardDays: 30,
      },
    });
    await user.click(loyaltySwitch());
    expect(screen.getByText("No new stamps are earned while the program is off.")).toBeInTheDocument();
    await user.click(saveButton());

    await waitFor(() => expect(saveLoyaltyProgram).toHaveBeenCalledWith({ enabled: false, n: 5, k: 3, r: 30 }));
    await waitFor(() =>
      expect(screen.queryByText("No new stamps are earned while the program is off.")).not.toBeInTheDocument(),
    );
  });

  it("shows the stored values again after edits are discarded by saving off", async () => {
    const user = userEvent.setup();
    await renderForm({
      settings: {
        loyaltyEnabled: true,
        loyaltyGuestThreshold: 5,
        loyaltyRenewalThreshold: 3,
        loyaltyRewardDays: 30,
      },
    });
    setValue(nInput(), "9");
    setValue(kInput(), "8");
    setValue(rInput(), "7");
    await user.click(loyaltySwitch());
    await user.click(saveButton());

    await waitFor(() => expect(saveLoyaltyProgram).toHaveBeenCalledWith({ enabled: false, n: 5, k: 3, r: 30 }));
    await waitFor(() => expect(nInput()).toHaveValue(5));
    expect(kInput()).toHaveValue(3);
    expect(rInput()).toHaveValue(30);
  });

  it("disabling a never-configured program sends 2/3/1", async () => {
    const user = userEvent.setup();
    await renderForm();
    await user.click(saveButton());
    await waitFor(() => expect(saveLoyaltyProgram).toHaveBeenCalledWith({ enabled: false, n: 2, k: 3, r: 1 }));
  });

  it("shows field errors on submit only and does not call the action", async () => {
    const user = userEvent.setup();
    await renderForm();
    await user.click(loyaltySwitch());
    setValue(nInput(), "1");
    setValue(kInput(), "25");
    expect(screen.queryByText("Enter a whole number from 2 to 50")).not.toBeInTheDocument();
    await user.click(saveButton());

    expect(screen.getByText("Enter a whole number from 2 to 50")).toBeInTheDocument();
    expect(screen.getByText("Enter a whole number from 3 to 24")).toBeInTheDocument();
    expect(screen.getByText("Enter a whole number from 1 to 30")).toBeInTheDocument();
    expect(saveLoyaltyProgram).not.toHaveBeenCalled();
  });

  it("shows the summary on any server refusal and stays editable", async () => {
    const user = userEvent.setup();
    saveLoyaltyProgram.mockResolvedValue({ data: null, error: { code: "unknown", message: "x" } });
    await renderForm();
    await user.click(loyaltySwitch());
    setValue(nInput(), "5");
    setValue(kInput(), "3");
    setValue(rInput(), "30");
    await user.click(saveButton());

    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't save the loyalty program. Try again.");
    expect(nInput()).toBeEnabled();
    expect(screen.queryByText("Loyalty program saved.")).not.toBeInTheDocument();
  });

  it("readout: guest percent after the pause, hidden for out-of-range, one subscriber line per duration", async () => {
    const user = userEvent.setup();
    await renderForm({
      plans: [
        { name: "Monthly", durationDays: 30 },
        { name: "Coach", durationDays: 30 },
        { name: "Annual", durationDays: 365 },
      ],
    });
    await user.click(loyaltySwitch());
    setValue(nInput(), "5");
    setValue(kInput(), "3");
    setValue(rInput(), "30");

    expect(await screen.findByText("1 free session per 5 paid ≈ 17%")).toBeInTheDocument();
    expect(screen.getByText("30 days per 3 renewals of a 30-day plan (Monthly) ≈ 25%")).toBeInTheDocument();
    expect(screen.getByText("30 days per 3 renewals of a 365-day plan (Annual) ≈ 3%")).toBeInTheDocument();
    expect(screen.queryByText(/\(Coach\)/)).not.toBeInTheDocument();
    expect(screen.getByText(/SR 1 free session per 5 paid, about 17%/)).toBeInTheDocument();

    setValue(nInput(), "99");
    await waitFor(() => expect(screen.queryByText("1 free session per 5 paid ≈ 17%")).not.toBeInTheDocument());
    expect(screen.queryByText("Enter a whole number from 2 to 50")).not.toBeInTheDocument();
  });

  it("readout: capped at three subscriber lines and hidden with no plan", async () => {
    const user = userEvent.setup();
    const plans = [7, 30, 90, 365].map((d) => ({ name: `P${d}`, durationDays: d }));
    const { unmount } = await renderForm({
      plans,
      settings: { loyaltyGuestThreshold: 5, loyaltyRenewalThreshold: 3, loyaltyRewardDays: 30 },
    });
    await user.click(loyaltySwitch());
    expect(await screen.findByText(/\(P90\) ≈/)).toBeInTheDocument();
    expect(screen.queryByText(/\(P365\) ≈/)).not.toBeInTheDocument();
    unmount();

    await renderForm({
      plans: [],
      settings: { loyaltyGuestThreshold: 5, loyaltyRenewalThreshold: 3, loyaltyRewardDays: 30 },
    });
    expect(await screen.findByText("1 free session per 5 paid ≈ 17%")).toBeInTheDocument();
    expect(screen.queryByText(/renewals of a/)).not.toBeInTheDocument();
  });

  it("shows the charging-off info line only while charging is off", async () => {
    const { unmount } = await renderForm({ settings: { chargeGuestsPerSession: false } });
    expect(screen.getByText("Guests earn nothing while Charge guests per session is off.")).toBeInTheDocument();
    unmount();
    await renderForm({ settings: { chargeGuestsPerSession: true } });
    expect(
      screen.queryByText("Guests earn nothing while Charge guests per session is off."),
    ).not.toBeInTheDocument();
  });

  it("shows the lowered-threshold note when N or K drops below the saved value", async () => {
    const user = userEvent.setup();
    await renderForm({
      settings: {
        loyaltyEnabled: true,
        loyaltyGuestThreshold: 5,
        loyaltyRenewalThreshold: 6,
        loyaltyRewardDays: 30,
      },
    });
    const note = "Members already at or above the new number earn one reward.";
    expect(screen.queryByText(note)).not.toBeInTheDocument();
    setValue(nInput(), "4");
    expect(screen.getByText(note)).toBeInTheDocument();
    setValue(nInput(), "5");
    expect(screen.queryByText(note)).not.toBeInTheDocument();
    setValue(kInput(), "3");
    expect(screen.getByText(note)).toBeInTheDocument();
    void user;
  });

  it("updates the turn-off dialog clause once the program is saved on", async () => {
    const user = userEvent.setup();
    await renderForm({ settings: { chargeGuestsPerSession: true } });
    await user.click(loyaltySwitch());
    setValue(nInput(), "5");
    setValue(kInput(), "3");
    setValue(rInput(), "30");
    await user.click(saveButton());
    await screen.findByText("Loyalty program saved.");

    await user.click(screen.getByRole("switch", { name: "Charge guests per session" }));
    expect(await screen.findByText("Guests stop earning loyalty stamps.")).toBeInTheDocument();
  });
});
