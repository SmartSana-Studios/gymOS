/**
 * Story 28.1: `saveSessionValidity` Server Action.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const setSessionValidityRow = vi.fn();

vi.mock("@/services/gym-settings", () => ({
  ALLOWED_LOGO_MIME_TYPES: new Map(),
  MAX_LOGO_BYTES: 5 * 1024 * 1024,
  getGuestChargingImpact: vi.fn(),
  logGymSettingsChange: vi.fn(),
  regenerateQrCode: vi.fn(),
  setGuestCharging: vi.fn(),
  setGymCategory: vi.fn(),
  setSessionValidity: (...a: unknown[]) => setSessionValidityRow(...a),
  setLoyaltyProgram: vi.fn(),
  setRegistrationFee: vi.fn(),
  updateGymSettings: vi.fn(),
  uploadGymLogo: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/services/billing", () => ({
  getGymBillingInfo: vi.fn(),
  initiateSaasBillingPayment: vi.fn(),
  createSaasBillingHostedCheckoutLink: vi.fn(),
  updateOwnerNotificationEmail: vi.fn(),
}));
vi.mock("@/services/gym-payment-credentials", () => ({
  connectGymPaymentCredentials: vi.fn(),
  disconnectGymPaymentCredentials: vi.fn(),
  getGymPaymentConnectionStatus: vi.fn(),
  maskBusinessId: vi.fn(),
}));
vi.mock("@/lib/i18n/get-request-locale", () => ({ getRequestLocale: vi.fn(async () => "en") }));
vi.mock("@/lib/i18n/get-server-translation", () => ({
  getServerTranslation: vi.fn(async () => ({ t: (key: string) => key })),
}));

beforeEach(() => {
  setSessionValidityRow.mockReset().mockResolvedValue({ data: { ok: true }, error: null });
});

describe("saveSessionValidity", () => {
  it.each(["whole_day", "single_use"])("passes %s to the setter", async (value) => {
    const { saveSessionValidity } = await import("./actions");
    await expect(saveSessionValidity(value)).resolves.toEqual({ data: { ok: true }, error: null });
    expect(setSessionValidityRow).toHaveBeenCalledWith(value);
  });

  it.each(["Single use", "weekly", "", null, undefined, 3])("rejects %s without calling the setter", async (value) => {
    const { saveSessionValidity } = await import("./actions");
    const result = await saveSessionValidity(value);
    expect(result.error).toEqual({ code: "validation_error", message: "settings.sessionValidity.error" });
    expect(setSessionValidityRow).not.toHaveBeenCalled();
  });

  it("replaces a setter refusal with the fixed message", async () => {
    setSessionValidityRow.mockResolvedValue({ data: null, error: { code: "unknown", message: "permission denied" } });
    const { saveSessionValidity } = await import("./actions");
    await expect(saveSessionValidity("single_use")).resolves.toEqual({
      data: null,
      error: { code: "unknown", message: "settings.sessionValidity.error" },
    });
  });
});
