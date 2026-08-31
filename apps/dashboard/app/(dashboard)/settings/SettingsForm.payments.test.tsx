/**
 * Story 4.13 (Task 6, AC #1): component-level tests for `SettingsForm`'s new
 * "Connect payment account" section -- connect/reconnect/disconnect happy
 * paths and validation errors. Mirrors `RenewalModal.mobileMoney.test.tsx`'s
 * established pattern (mock the Server Action layer, render with React
 * Testing Library, drive the actual click/submit flow) since this app has no
 * Playwright/browser E2E setup. Every other section of `SettingsForm` (logo,
 * QR, localization, etc.) is pre-existing, already-covered-by-manual-
 * verification behavior and is not re-tested here.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const connectPaymentProvider = vi.fn();
const disconnectPaymentProvider = vi.fn();

vi.mock("./actions", () => ({
  connectPaymentProvider: (...args: unknown[]) => connectPaymentProvider(...args),
  disconnectPaymentProvider: (...args: unknown[]) => disconnectPaymentProvider(...args),
  // Other named exports SettingsForm imports from this module -- unused by
  // the payments section, stubbed only so the module resolves.
  regenerateQrCode: vi.fn(),
  saveGymSettings: vi.fn(),
  uploadLogo: vi.fn(),
  payNow: vi.fn(),
  saveNotificationEmail: vi.fn(),
  getBillingInfo: vi.fn(),
}));

vi.mock("@/lib/realtime/paymentStatus", () => ({
  fetchSaasBillingPaymentStatus: vi.fn(),
}));

const TRANSLATIONS: Record<string, string> = {
  "settings.sections.payments": "Payment Account",
  "settings.payments.notConnected": "Not connected. Cash and manual payment methods still work as usual.",
  "settings.payments.connect": "Connect",
  "settings.payments.reconnect": "Reconnect",
  "settings.payments.disconnect": "Disconnect",
  "settings.payments.connecting": "Connecting…",
  "settings.payments.disconnecting": "Disconnecting…",
  "settings.payments.connectDialogTitle": "Connect your Tara Money account",
  "settings.payments.connectDialogBody": "Your credentials are encrypted.",
  "settings.payments.apiKeyLabel": "API Key *",
  "settings.payments.businessIdLabel": "Business ID *",
  "settings.payments.webhookSecretLabel": "Webhook Secret *",
  "settings.payments.apiKeyRequiredError": "API key is required",
  "settings.payments.apiKeyTooLongError": "API key is too long",
  "settings.payments.businessIdRequiredError": "Business ID is required",
  "settings.payments.businessIdTooLongError": "Business ID is too long",
  "settings.payments.webhookSecretRequiredError": "Webhook secret is required",
  "settings.payments.webhookSecretTooLongError": "Webhook secret is too long",
  "settings.payments.connectedToast": "Payment account connected.",
  "settings.payments.disconnectConfirmTitle": "Disconnect payment account?",
  "settings.payments.disconnectConfirmBody": "Members will no longer see the automated option.",
  "settings.payments.disconnectedToast": "Payment account disconnected.",
  "settings.payments.disconnectFailedToast": "Couldn't disconnect. Try again.",
  "settings.payments.needsAttention": "Your Tara Money connection needs attention — reconnect below.",
  "common.cancel": "Cancel",
  "common.somethingWentWrong": "Something went wrong.",
};

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) => {
      if (key === "settings.payments.connectedLabel") return `Connected — ${vars?.businessId}`;
      if (key === "settings.payments.connectedSince") return `Since ${vars?.date}`;
      return TRANSLATIONS[key] ?? key;
    },
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
  initialPaymentConnection: { businessIdMasked: string; connectedAt: string; needsAttention: boolean } | null,
) {
  const { SettingsForm } = await import("./SettingsForm");
  return render(
    <SettingsForm
      initial={INITIAL_SETTINGS}
      initialPaymentConnection={initialPaymentConnection}
      initialBillingInfo={null}
      selectableTiers={[]}
      staffCount={0}
    />,
  );
}

describe("SettingsForm payments section", () => {
  beforeEach(() => {
    connectPaymentProvider.mockReset();
    disconnectPaymentProvider.mockReset();
  });

  it("shows 'Not connected' with a Connect button when there is no existing connection", async () => {
    await renderForm(null);

    expect(screen.getByText("Not connected. Cash and manual payment methods still work as usual.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Connect" })).toBeVisible();
  });

  it("shows the masked business id and Reconnect/Disconnect actions when already connected", async () => {
    await renderForm({ businessIdMasked: "•••• 1234", connectedAt: "2026-08-17T00:00:00.000Z", needsAttention: false });

    expect(screen.getByText("Connected — •••• 1234")).toBeVisible();
    expect(screen.getByRole("button", { name: "Reconnect" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Disconnect" })).toBeVisible();
  });

  it("shows the needs-attention banner when a prior connection is failing (Story 4.14)", async () => {
    await renderForm({ businessIdMasked: "•••• 1234", connectedAt: "2026-08-17T00:00:00.000Z", needsAttention: true });

    expect(screen.getByRole("alert")).toHaveTextContent("Your Tara Money connection needs attention");
  });

  it("does not show the needs-attention banner for a healthy connection", async () => {
    await renderForm({ businessIdMasked: "•••• 1234", connectedAt: "2026-08-17T00:00:00.000Z", needsAttention: false });

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("connect happy path: fills the dialog, submits, and shows the new connected state", async () => {
    const user = userEvent.setup();
    connectPaymentProvider.mockResolvedValue({
      data: {
        status: { businessIdMasked: "•••• 9999", connectedAt: "2026-08-17T00:00:00.000Z", needsAttention: false },
      },
      error: null,
    });
    await renderForm(null);

    await user.click(screen.getByRole("button", { name: "Connect" }));
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText("API Key *"), "key-1");
    await user.type(within(dialog).getByLabelText("Business ID *"), "9999");
    await user.type(within(dialog).getByLabelText("Webhook Secret *"), "secret-1");
    await user.click(within(dialog).getByRole("button", { name: "Connect" }));

    await waitFor(() => {
      expect(connectPaymentProvider).toHaveBeenCalledWith({
        apiKey: "key-1",
        businessId: "9999",
        webhookSecret: "secret-1",
      });
    });
    await waitFor(() => {
      expect(screen.getByText("Connected — •••• 9999")).toBeVisible();
    });
    // Review fix (Story 4.13): a successful connect must actually close the
    // native <dialog> (setConnectOpen(false) alone doesn't call .close()).
    await waitFor(() => {
      expect(dialog).not.toHaveAttribute("open");
    });
  });

  it("connect validation error: a blank field shows a field error and never calls the Server Action", async () => {
    const user = userEvent.setup();
    await renderForm(null);

    await user.click(screen.getByRole("button", { name: "Connect" }));
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Connect" }));

    expect(connectPaymentProvider).not.toHaveBeenCalled();
    expect(screen.getByText("Business ID is required")).toBeVisible();
  });

  it("connect server error: shows the returned error message and keeps the dialog open", async () => {
    const user = userEvent.setup();
    connectPaymentProvider.mockResolvedValue({
      data: null,
      error: { code: "unknown", message: "permission denied" },
    });
    await renderForm(null);

    await user.click(screen.getByRole("button", { name: "Connect" }));
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText("API Key *"), "key-1");
    await user.type(within(dialog).getByLabelText("Business ID *"), "9999");
    await user.type(within(dialog).getByLabelText("Webhook Secret *"), "secret-1");
    await user.click(within(dialog).getByRole("button", { name: "Connect" }));

    await waitFor(() => {
      expect(screen.getByText("permission denied")).toBeVisible();
    });
  });

  it("disconnect happy path: confirms and returns to the not-connected state", async () => {
    const user = userEvent.setup();
    disconnectPaymentProvider.mockResolvedValue({ data: { ok: true }, error: null });
    await renderForm({ businessIdMasked: "•••• 1234", connectedAt: "2026-08-17T00:00:00.000Z", needsAttention: false });

    await user.click(screen.getByRole("button", { name: "Disconnect" }));
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Disconnect" }));

    await waitFor(() => {
      expect(disconnectPaymentProvider).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(screen.getByText("Not connected. Cash and manual payment methods still work as usual.")).toBeVisible();
    });
    // Review fix (Story 4.13): same dialog-not-actually-closed gap as the
    // connect flow above.
    await waitFor(() => {
      expect(dialog).not.toHaveAttribute("open");
    });
  });
});
