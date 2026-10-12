/**
 * Story 19.9a: `SettingsForm`'s charge-guests-per-session control -- role gate,
 * confirmation dialogs, own-setter save, and exclusion from [Save Settings].
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const setGuestCharging = vi.fn();
const getGuestChargingImpact = vi.fn();
const saveGymSettings = vi.fn();

vi.mock("./actions", () => ({
  connectPaymentProvider: vi.fn(),
  disconnectPaymentProvider: vi.fn(),
  regenerateQrCode: vi.fn(),
  saveGymSettings: (...args: unknown[]) => saveGymSettings(...args),
  uploadLogo: vi.fn(),
  payNow: vi.fn(),
  saveNotificationEmail: vi.fn(),
  saveRegistrationFee: vi.fn(),
  getBillingInfo: vi.fn(),
  getGuestChargingImpact: (...args: unknown[]) => getGuestChargingImpact(...args),
  setGuestCharging: (...args: unknown[]) => setGuestCharging(...args),
}));

vi.mock("@/lib/realtime/paymentStatus", () => ({
  fetchSaasBillingPaymentStatus: vi.fn(),
}));

const TRANSLATIONS: Record<string, string> = {
  "settings.guestCharging.label": "Charge guests per session",
  "settings.guestCharging.saveFailed": "Couldn't change this setting. Try again.",
  "settings.guestCharging.onTitle": "Start charging guests per session?",
  "settings.guestCharging.impactLoading": "Counting affected members…",
  "settings.guestCharging.impactError": "Couldn't count affected members.",
  "settings.guestCharging.retry": "Retry",
  "settings.guestCharging.impactZero": "No members are on a Pay-per-session plan yet.",
  "settings.guestCharging.impactOne": "1 Pay-per-session member will need a paid session at their next visit.",
  "settings.guestCharging.impactMany": "{{count}} Pay-per-session members will need a paid session at their next visit.",
  "settings.guestCharging.start": "Start charging",
  "settings.guestCharging.onToast": "Guests now pay per session.",
  "settings.guestCharging.offTitle": "Stop charging guests per session?",
  "settings.guestCharging.offKept_other": "Kept sessions lapse {{count}} days after payment.",
  "settings.guestCharging.offKept": "Kept sessions lapse {{count}} days after payment.",
  "settings.guestCharging.offStamps": "Guests stop earning loyalty stamps.",
  "settings.guestCharging.stop": "Stop charging",
  "settings.guestCharging.offToast": "Guests no longer pay per session.",
  "settings.guestCharging.oldAppWarning": "Old app versions show expired.",
  "common.cancel": "Cancel",
  "common.saving": "Saving…",
  "settings.saveButton": "Save Settings",
};

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { count?: number }) =>
      (TRANSLATIONS[key] ?? key).replace("{{count}}", String(opts?.count ?? "")),
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
};

async function renderForm(props: { role?: string | null; charging?: boolean; loyaltyEnabled?: boolean } = {}) {
  const { SettingsForm } = await import("./SettingsForm");
  return render(
    <SettingsForm
      initial={{ ...INITIAL_SETTINGS, chargeGuestsPerSession: props.charging ?? false }}
      initialPaymentConnection={null}
      initialBillingInfo={null}
      selectableTiers={[]}
      staffCount={0}
      role={props.role === undefined ? "owner" : props.role}
      loyaltyEnabled={props.loyaltyEnabled}
    />,
  );
}

const toggle = () => screen.getByRole("switch", { name: "Charge guests per session" });

describe("SettingsForm charge guests per session", () => {
  beforeEach(() => {
    setGuestCharging.mockReset().mockResolvedValue({ data: { ok: true }, error: null });
    getGuestChargingImpact.mockReset().mockResolvedValue({ data: { count: 12, validityDays: 7 }, error: null });
    saveGymSettings.mockReset().mockResolvedValue({ data: { ok: true }, error: null, warning: null });
  });

  it.each(["owner", "supervisor"])("renders the control for %s", async (role) => {
    await renderForm({ role });
    expect(toggle()).toHaveAttribute("aria-checked", "false");
  });

  it.each(["manager", "receptionist", "coach", null])("is absent from the DOM for role %s", async (role) => {
    await renderForm({ role });
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    expect(screen.queryByText("Charge guests per session")).not.toBeInTheDocument();
  });

  it("does not flip until confirmed, then turns on with the toast", async () => {
    const user = userEvent.setup();
    await renderForm();

    await user.click(toggle());
    expect(toggle()).toHaveAttribute("aria-checked", "false");
    await waitFor(() =>
      expect(screen.getByText("12 Pay-per-session members will need a paid session at their next visit.")).toBeInTheDocument(),
    );
    expect(screen.getByText("Old app versions show expired.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Confirm" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Start charging" }));

    await waitFor(() => expect(setGuestCharging).toHaveBeenCalledWith(true));
    await waitFor(() => expect(screen.getByText("Guests now pay per session.")).toBeVisible());
    expect(toggle()).toHaveAttribute("aria-checked", "true");
  });

  it("uses the singular and zero copy", async () => {
    const user = userEvent.setup();
    getGuestChargingImpact.mockResolvedValue({ data: { count: 1, validityDays: 7 }, error: null });
    const { unmount } = await renderForm();
    await user.click(toggle());
    await waitFor(() =>
      expect(screen.getByText("1 Pay-per-session member will need a paid session at their next visit.")).toBeInTheDocument(),
    );
    unmount();

    getGuestChargingImpact.mockResolvedValue({ data: { count: 0, validityDays: 7 }, error: null });
    await renderForm();
    await user.click(toggle());
    await waitFor(() =>
      expect(screen.getByText("No members are on a Pay-per-session plan yet.")).toBeInTheDocument(),
    );
  });

  it("focuses Cancel and ignores Escape", async () => {
    const user = userEvent.setup();
    await renderForm();
    await user.click(toggle());
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Cancel" })[0]).toHaveFocus());

    const dialog = screen.getAllByRole("button", { name: "Cancel" })[0].closest("dialog")!;
    const cancelEvent = new Event("cancel", { cancelable: true });
    dialog.dispatchEvent(cancelEvent);
    expect(cancelEvent.defaultPrevented).toBe(true);
  });

  it("Cancel closes without saving and keeps the stored value", async () => {
    const user = userEvent.setup();
    await renderForm();
    await user.click(toggle());
    await user.click(screen.getAllByRole("button", { name: "Cancel" })[0]);

    expect(setGuestCharging).not.toHaveBeenCalled();
    expect(toggle()).toHaveAttribute("aria-checked", "false");
  });

  it("count failure shows the message, disables Start, and Retry re-calls", async () => {
    const user = userEvent.setup();
    getGuestChargingImpact.mockResolvedValueOnce({ data: null, error: { code: "unknown", message: "x" } });
    await renderForm();
    await user.click(toggle());

    await waitFor(() => expect(screen.getAllByText("Couldn't count affected members.").length).toBeGreaterThan(0));
    expect(screen.getByRole("button", { name: "Start charging" })).toBeDisabled();

    await user.click(screen.getAllByRole("button", { name: "Retry" })[0]);
    await waitFor(() => expect(getGuestChargingImpact).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole("button", { name: "Start charging" })).toBeEnabled());
  });

  it("a server refusal shows the inline message and keeps the toggle off", async () => {
    const user = userEvent.setup();
    setGuestCharging.mockResolvedValue({
      data: null,
      error: { code: "unknown", message: "Couldn't change this setting. Try again." },
    });
    await renderForm();
    await user.click(toggle());
    await waitFor(() => expect(screen.getByRole("button", { name: "Start charging" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "Start charging" }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Couldn't change this setting. Try again."));
    expect(toggle()).toHaveAttribute("aria-checked", "false");
    expect(screen.queryByText("Guests now pay per session.")).not.toBeInTheDocument();
  });

  it("turn-off dialog shows the validity days, omits stamps by default, and turns off", async () => {
    const user = userEvent.setup();
    getGuestChargingImpact.mockResolvedValue({ data: { count: 3, validityDays: 10 }, error: null });
    await renderForm({ charging: true });

    expect(toggle()).toHaveAttribute("aria-checked", "true");
    await user.click(toggle());
    await waitFor(() => expect(screen.getByText("Kept sessions lapse 10 days after payment.")).toBeInTheDocument());
    expect(screen.getByText("Stop charging guests per session?")).toBeInTheDocument();
    expect(screen.queryByText("Guests stop earning loyalty stamps.")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Stop charging" }));
    await waitFor(() => expect(setGuestCharging).toHaveBeenCalledWith(false));
    await waitFor(() => expect(screen.getByText("Guests no longer pay per session.")).toBeVisible());
    expect(toggle()).toHaveAttribute("aria-checked", "false");
  });

  it("turn-off dialog keeps Stop enabled when the impact read fails, without the validity line", async () => {
    const user = userEvent.setup();
    getGuestChargingImpact.mockResolvedValueOnce({ data: null, error: { code: "unknown", message: "x" } });
    await renderForm({ charging: true });
    await user.click(toggle());

    await waitFor(() => expect(getGuestChargingImpact).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole("button", { name: "Stop charging" })).toBeEnabled());
    expect(screen.queryByText(/lapse/)).not.toBeInTheDocument();
    const offDialog = screen.getByRole("button", { name: "Stop charging" }).closest("dialog")!;
    expect(within(offDialog).queryByText("Couldn't count affected members.")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Stop charging" }));
    await waitFor(() => expect(setGuestCharging).toHaveBeenCalledWith(false));
  });

  it("turn-off dialog disables Stop only while the impact is loading", async () => {
    const user = userEvent.setup();
    let resolveImpact: (v: unknown) => void = () => {};
    getGuestChargingImpact.mockReturnValueOnce(new Promise((r) => (resolveImpact = r)));
    await renderForm({ charging: true });
    await user.click(toggle());

    expect(screen.getByRole("button", { name: "Stop charging" })).toBeDisabled();
    resolveImpact({ data: { count: 3, validityDays: 10 }, error: null });
    await waitFor(() => expect(screen.getByRole("button", { name: "Stop charging" })).toBeEnabled());
  });

  it("ignores an Escape keydown on the dialog", async () => {
    const user = userEvent.setup();
    await renderForm();
    await user.click(toggle());
    const dialog = screen.getAllByRole("button", { name: "Cancel" })[0].closest("dialog")!;

    expect(fireEvent.keyDown(dialog, { key: "Escape" })).toBe(false);
  });

  it("disables the switch and Cancel while the save is in flight", async () => {
    const user = userEvent.setup();
    let resolveSave: (v: unknown) => void = () => {};
    setGuestCharging.mockReturnValueOnce(new Promise((r) => (resolveSave = r)));
    await renderForm();
    await user.click(toggle());
    await waitFor(() => expect(screen.getByRole("button", { name: "Start charging" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "Start charging" }));

    await waitFor(() => expect(toggle()).toBeDisabled());
    expect(screen.getAllByRole("button", { name: "Cancel" })[0]).toBeDisabled();

    resolveSave({ data: { ok: true }, error: null });
    await waitFor(() => expect(screen.getByText("Guests now pay per session.")).toBeVisible());
  });

  it("drops a late impact response after Cancel and re-open", async () => {
    const user = userEvent.setup();
    let resolveFirst: (v: unknown) => void = () => {};
    getGuestChargingImpact
      .mockReturnValueOnce(new Promise((r) => (resolveFirst = r)))
      .mockResolvedValueOnce({ data: { count: 3, validityDays: 7 }, error: null });
    await renderForm();
    await user.click(toggle());
    await user.click(screen.getAllByRole("button", { name: "Cancel" })[0]);
    await user.click(toggle());
    await waitFor(() =>
      expect(screen.getByText("3 Pay-per-session members will need a paid session at their next visit.")).toBeInTheDocument(),
    );

    resolveFirst({ data: { count: 99, validityDays: 7 }, error: null });
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByText(/^99 Pay-per-session/)).not.toBeInTheDocument();
    expect(screen.getByText("3 Pay-per-session members will need a paid session at their next visit.")).toBeInTheDocument();
  });

  it("turn-off dialog adds the stamps clause only when loyaltyEnabled", async () => {
    const user = userEvent.setup();
    await renderForm({ charging: true, loyaltyEnabled: true });
    await user.click(toggle());
    await waitFor(() => expect(screen.getByText("Guests stop earning loyalty stamps.")).toBeInTheDocument());
  });

  it("the general save payload carries no charging field and never calls the setter", async () => {
    await renderForm();
    fireEvent.submit(screen.getByRole("button", { name: "Save Settings" }).closest("form")!);

    await waitFor(() => expect(saveGymSettings).toHaveBeenCalledTimes(1));
    expect(JSON.stringify(saveGymSettings.mock.calls[0][0]).toLowerCase()).not.toContain("charg");
    expect(setGuestCharging).not.toHaveBeenCalled();
  });
});
