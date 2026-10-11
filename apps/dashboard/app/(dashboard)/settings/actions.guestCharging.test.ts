/**
 * Story 19.9a: `getGuestChargingImpact` / `setGuestCharging` Server Actions.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const getGuestChargingImpactRow = vi.fn();
const setGuestChargingRow = vi.fn();
const maybeSingle = vi.fn();
const adminFrom = vi.fn();

vi.mock("@/services/gym-settings", () => ({
  ALLOWED_LOGO_MIME_TYPES: new Map(),
  MAX_LOGO_BYTES: 5 * 1024 * 1024,
  getGuestChargingImpact: (...a: unknown[]) => getGuestChargingImpactRow(...a),
  logGymSettingsChange: vi.fn(),
  regenerateQrCode: vi.fn(),
  setGuestCharging: (...a: unknown[]) => setGuestChargingRow(...a),
  setRegistrationFee: vi.fn(),
  updateGymSettings: vi.fn(),
  uploadGymLogo: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: (...a: unknown[]) => adminFrom(...a) }),
}));

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
  getGuestChargingImpactRow.mockReset().mockResolvedValue({ data: 4, error: null });
  setGuestChargingRow.mockReset().mockResolvedValue({ data: { ok: true }, error: null });
  maybeSingle.mockReset().mockResolvedValue({ data: { paid_session_validity_days: 14 }, error: null });
  adminFrom.mockReset().mockReturnValue({ select: () => ({ limit: () => ({ maybeSingle }) }) });
});

describe("getGuestChargingImpact", () => {
  it("returns the count and the configured validity days", async () => {
    const { getGuestChargingImpact } = await import("./actions");
    await expect(getGuestChargingImpact()).resolves.toEqual({ data: { count: 4, validityDays: 14 }, error: null });
    expect(adminFrom).toHaveBeenCalledWith("platform_session_config");
  });

  it("falls back to 7 days when the config read fails", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: { message: "boom" } });
    const { getGuestChargingImpact } = await import("./actions");
    const result = await getGuestChargingImpact();
    expect(result.data).toEqual({ count: 4, validityDays: 7 });
  });

  it("falls back to 7 days when the admin client throws", async () => {
    adminFrom.mockImplementation(() => {
      throw new Error("no key");
    });
    const { getGuestChargingImpact } = await import("./actions");
    const result = await getGuestChargingImpact();
    expect(result.data).toEqual({ count: 4, validityDays: 7 });
  });

  it("does not read the config when the role check (impact RPC) refuses", async () => {
    getGuestChargingImpactRow.mockResolvedValue({ data: null, error: { code: "unknown", message: "denied" } });
    const { getGuestChargingImpact } = await import("./actions");
    const result = await getGuestChargingImpact();
    expect(result.data).toBeNull();
    expect(result.error).not.toBeNull();
    expect(adminFrom).not.toHaveBeenCalled();
  });
});

describe("setGuestCharging", () => {
  it.each([true, false])("passes %s to the service", async (value) => {
    const { setGuestCharging } = await import("./actions");
    await expect(setGuestCharging(value)).resolves.toEqual({ data: { ok: true }, error: null });
    expect(setGuestChargingRow).toHaveBeenCalledWith(value);
  });

  it.each(["true", 1, null, undefined])("rejects non-boolean %s without calling the service", async (value) => {
    const { setGuestCharging } = await import("./actions");
    const result = await setGuestCharging(value);
    expect(result.error?.code).toBe("validation_error");
    expect(setGuestChargingRow).not.toHaveBeenCalled();
  });

  it("replaces a service refusal with the fixed message", async () => {
    setGuestChargingRow.mockResolvedValue({ data: null, error: { code: "unknown", message: "permission denied" } });
    const { setGuestCharging } = await import("./actions");
    const result = await setGuestCharging(true);
    expect(result).toEqual({
      data: null,
      error: { code: "unknown", message: "settings.guestCharging.saveFailed" },
    });
  });
});
