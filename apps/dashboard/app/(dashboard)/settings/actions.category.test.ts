/**
 * Story 21.2: `saveGymCategory` Server Action.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const setGymCategoryRow = vi.fn();

vi.mock("@/services/gym-settings", () => ({
  ALLOWED_LOGO_MIME_TYPES: new Map(),
  MAX_LOGO_BYTES: 5 * 1024 * 1024,
  getGuestChargingImpact: vi.fn(),
  logGymSettingsChange: vi.fn(),
  regenerateQrCode: vi.fn(),
  setGuestCharging: vi.fn(),
  setGymCategory: (...a: unknown[]) => setGymCategoryRow(...a),
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
  setGymCategoryRow.mockReset().mockResolvedValue({ data: { ok: true }, error: null });
});

describe("saveGymCategory", () => {
  it.each(["gym", "pilates_studio", "yoga_studio", "fitness_center", "other"])(
    "passes %s to the setter",
    async (code) => {
      const { saveGymCategory } = await import("./actions");
      await expect(saveGymCategory(code)).resolves.toEqual({ data: { ok: true }, error: null });
      expect(setGymCategoryRow).toHaveBeenCalledWith(code);
    },
  );

  it.each(["Yoga Studio", "", null, undefined, 3])("rejects %s without calling the setter", async (value) => {
    const { saveGymCategory } = await import("./actions");
    const result = await saveGymCategory(value);
    expect(result.error).toEqual({ code: "validation_error", message: "settings.category.selectError" });
    expect(setGymCategoryRow).not.toHaveBeenCalled();
  });

  it("replaces a setter refusal with the fixed message", async () => {
    setGymCategoryRow.mockResolvedValue({ data: null, error: { code: "unknown", message: "permission denied" } });
    const { saveGymCategory } = await import("./actions");
    await expect(saveGymCategory("other")).resolves.toEqual({
      data: null,
      error: { code: "unknown", message: "settings.category.saveFailed" },
    });
  });
});
