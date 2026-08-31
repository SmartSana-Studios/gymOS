/**
 * Story 11.3 (Task 6, AC #1/#2): component-level tests for `SettingsForm`'s
 * new "Billing" section -- status display, the conditional "Pay Now"
 * button, and the notification-email save flow. Mirrors
 * `SettingsForm.payments.test.tsx`'s established pattern (mock the Server
 * Action layer, render with React Testing Library, drive the actual
 * click/submit flow).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const payNow = vi.fn();
const saveNotificationEmail = vi.fn();
const getBillingInfo = vi.fn();
const fetchSaasBillingPaymentStatus = vi.fn();

vi.mock("./actions", () => ({
  connectPaymentProvider: vi.fn(),
  disconnectPaymentProvider: vi.fn(),
  regenerateQrCode: vi.fn(),
  saveGymSettings: vi.fn(),
  uploadLogo: vi.fn(),
  payNow: (...args: unknown[]) => payNow(...args),
  saveNotificationEmail: (...args: unknown[]) => saveNotificationEmail(...args),
  getBillingInfo: (...args: unknown[]) => getBillingInfo(...args),
}));

vi.mock("@/lib/realtime/paymentStatus", () => ({
  fetchSaasBillingPaymentStatus: (...args: unknown[]) => fetchSaasBillingPaymentStatus(...args),
}));

const TRANSLATIONS: Record<string, string> = {
  "settings.sections.billing": "Billing",
  "settings.billing.intervalMonthly": "Monthly",
  "settings.billing.intervalAnnual": "Annual",
  "settings.billing.status.active": "Active",
  "settings.billing.status.past_due": "Past due",
  "settings.billing.status.grace_period": "Grace period",
  "settings.billing.status.suspended": "Suspended",
  "settings.billing.payNow": "Pay Now",
  "settings.billing.payNowDialogTitle": "Pay Now",
  "settings.billing.payNowDialogBody": "Confirm the mobile-money number to charge.",
  "settings.billing.payerPhoneLabel": "Payer phone number",
  "settings.billing.payNowLoading": "Starting payment…",
  "settings.billing.payPending": "Waiting for payment confirmation…",
  "settings.billing.payFailed": "The payment didn't go through. You can try again.",
  "settings.billing.paymentConfirmedToast": "Payment confirmed — your subscription is active.",
  "settings.billing.emailLabel": "Notification email",
  "settings.billing.emailHint": "Optional.",
  "settings.billing.emailSavedToast": "Notification email saved.",
  "common.save": "Save",
  "common.saving": "Saving…",
  "common.cancel": "Cancel",
  "common.invalidInput": "Invalid input",
  "common.somethingWentWrong": "Something went wrong.",
};

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) => {
      if (key === "settings.billing.nextBillingDate") return `Next billing date: ${vars?.date}`;
      return TRANSLATIONS[key] ?? key;
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
  gracePeriodDays: 3,
  capacity: 100,
  alertAutoDismissMinutes: 30,
  checkinTimeoutHours: 12,
  gymToken: "token-1",
};

async function renderForm(
  initialBillingInfo: {
    tierName: string;
    interval: "monthly" | "annual";
    billingStatus: "active" | "past_due" | "grace_period" | "suspended";
    anchorDate: string;
    notificationEmail: string | null;
    ownerPhone?: string | null;
  } | null,
) {
  const { SettingsForm } = await import("./SettingsForm");
  return render(
    <SettingsForm
      initial={INITIAL_SETTINGS}
      initialPaymentConnection={null}
      initialBillingInfo={
        initialBillingInfo ? { ...initialBillingInfo, ownerPhone: initialBillingInfo.ownerPhone ?? null } : null
      }
      selectableTiers={[]}
      staffCount={0}
    />,
  );
}

describe("SettingsForm billing section", () => {
  beforeEach(() => {
    payNow.mockReset();
    saveNotificationEmail.mockReset();
    getBillingInfo.mockReset();
    fetchSaasBillingPaymentStatus.mockReset();
  });

  it("renders nothing when there is no billing info (fetch failed server-side)", async () => {
    await renderForm(null);

    expect(screen.queryByText("Billing")).not.toBeInTheDocument();
  });

  it("shows the tier/interval/status/next-billing-date, and no Pay Now button, when active", async () => {
    await renderForm({
      tierName: "Hustle",
      interval: "monthly",
      billingStatus: "active",
      anchorDate: "2026-09-27",
      notificationEmail: null,
    });

    expect(screen.getByText(/Hustle/)).toBeVisible();
    expect(screen.getByText(/Monthly/)).toBeVisible();
    expect(screen.getByText("Active")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Pay Now" })).not.toBeInTheDocument();
  });

  it("shows the Pay Now button when billing status is past_due", async () => {
    await renderForm({
      tierName: "Hustle",
      interval: "monthly",
      billingStatus: "past_due",
      anchorDate: "2026-08-27",
      notificationEmail: null,
    });

    expect(screen.getByText("Past due")).toBeVisible();
    expect(screen.getByRole("button", { name: "Pay Now" })).toBeVisible();
  });

  it("Pay Now: opens a dialog pre-filled with the owner's own on-file phone, editable, calls the action with the (possibly edited) number, and shows the pending state on success", async () => {
    const user = userEvent.setup();
    payNow.mockResolvedValue({ data: { paymentId: "pay-1" }, error: null });
    fetchSaasBillingPaymentStatus.mockResolvedValue({ id: "pay-1", status: "processing" });
    await renderForm({
      tierName: "Hustle",
      interval: "monthly",
      billingStatus: "suspended",
      anchorDate: "2026-08-01",
      notificationEmail: null,
      ownerPhone: "+237600000001",
    });

    await user.click(screen.getByRole("button", { name: "Pay Now" }));
    const dialog = screen.getByRole("dialog");
    const phoneInput = within(dialog).getByLabelText("Payer phone number") as HTMLInputElement;
    expect(phoneInput.value).toBe("+237600000001");

    await user.clear(phoneInput);
    await user.type(phoneInput, "+237600000099");
    await user.click(within(dialog).getByRole("button", { name: "Pay Now" }));

    await waitFor(() => expect(payNow).toHaveBeenCalledWith({ phoneNumber: "+237600000099" }));
    await waitFor(() => expect(screen.getByText("Waiting for payment confirmation…")).toBeVisible());
    // A successful submit must actually close the native <dialog>.
    await waitFor(() => expect(dialog).not.toHaveAttribute("open"));
  });

  it("Pay Now: shows a generic error inside the dialog and does not enter the pending state when the action fails", async () => {
    const user = userEvent.setup();
    payNow.mockResolvedValue({ data: null, error: { code: "not_found", message: "No active plan." } });
    await renderForm({
      tierName: "Hustle",
      interval: "monthly",
      billingStatus: "suspended",
      anchorDate: "2026-08-01",
      notificationEmail: null,
      ownerPhone: "+237600000001",
    });

    await user.click(screen.getByRole("button", { name: "Pay Now" }));
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Pay Now" }));

    await waitFor(() => expect(within(dialog).getByText("No active plan.")).toBeVisible());
    expect(screen.queryByText("Waiting for payment confirmation…")).not.toBeInTheDocument();
  });

  it("notification email: pre-fills from initialBillingInfo, saves on click, and shows a confirmation toast", async () => {
    const user = userEvent.setup();
    saveNotificationEmail.mockResolvedValue({ data: { ok: true }, error: null });
    await renderForm({
      tierName: "Hustle",
      interval: "monthly",
      billingStatus: "active",
      anchorDate: "2026-09-27",
      notificationEmail: "owner@example.com",
    });

    const input = screen.getByLabelText("Notification email") as HTMLInputElement;
    expect(input.value).toBe("owner@example.com");

    await user.clear(input);
    await user.type(input, "new-owner@example.com");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(saveNotificationEmail).toHaveBeenCalledWith("new-owner@example.com"));
    await waitFor(() => expect(screen.getByText("Notification email saved.")).toBeVisible());
  });

  it("notification email: an invalid email shows a validation error and never calls the action", async () => {
    const user = userEvent.setup();
    await renderForm({
      tierName: "Hustle",
      interval: "monthly",
      billingStatus: "active",
      anchorDate: "2026-09-27",
      notificationEmail: null,
    });

    const input = screen.getByLabelText("Notification email");
    await user.type(input, "not-an-email");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.getByText("Enter a valid email address")).toBeVisible());
    expect(saveNotificationEmail).not.toHaveBeenCalled();
  });

  it("notification email: an empty input clears the field (saved as null, matching the RPC's own empty-string-clears semantics)", async () => {
    const user = userEvent.setup();
    saveNotificationEmail.mockResolvedValue({ data: { ok: true }, error: null });
    await renderForm({
      tierName: "Hustle",
      interval: "monthly",
      billingStatus: "active",
      anchorDate: "2026-09-27",
      notificationEmail: "owner@example.com",
    });

    const input = screen.getByLabelText("Notification email");
    await user.clear(input);
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(saveNotificationEmail).toHaveBeenCalledWith(null));
  });
});
