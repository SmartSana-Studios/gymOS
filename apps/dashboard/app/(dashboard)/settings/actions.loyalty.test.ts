/**
 * Story 20.5: `saveLoyaltyProgram` Server Action.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const setLoyaltyProgramRow = vi.fn();

vi.mock("@/services/gym-settings", () => ({
  ALLOWED_LOGO_MIME_TYPES: new Map(),
  MAX_LOGO_BYTES: 5 * 1024 * 1024,
  getGuestChargingImpact: vi.fn(),
  logGymSettingsChange: vi.fn(),
  regenerateQrCode: vi.fn(),
  setGuestCharging: vi.fn(),
  setLoyaltyProgram: (...a: unknown[]) => setLoyaltyProgramRow(...a),
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
  setLoyaltyProgramRow.mockReset().mockResolvedValue({ data: { ok: true }, error: null });
});

describe("saveLoyaltyProgram", () => {
  it("passes valid enable input through", async () => {
    const { saveLoyaltyProgram } = await import("./actions");
    await expect(saveLoyaltyProgram({ enabled: true, n: 5, k: 3, r: 30 })).resolves.toEqual({
      data: { ok: true },
      error: null,
    });
    expect(setLoyaltyProgramRow).toHaveBeenCalledWith({ enabled: true, n: 5, k: 3, r: 30 });
  });

  it.each([
    ["n too low", { enabled: true, n: 1, k: 3, r: 1 }],
    ["n too high", { enabled: true, n: 51, k: 3, r: 1 }],
    ["k too low", { enabled: true, n: 5, k: 2, r: 1 }],
    ["k too high", { enabled: true, n: 5, k: 25, r: 1 }],
    ["r zero", { enabled: true, n: 5, k: 3, r: 0 }],
    ["r too high", { enabled: true, n: 5, k: 3, r: 31 }],
    ["non-integer", { enabled: true, n: 5.5, k: 3, r: 1 }],
    ["string", { enabled: true, n: "5", k: 3, r: 1 }],
    ["missing", { enabled: true }],
    ["no enabled", { n: 5, k: 3, r: 1 }],
    ["not an object", null],
  ])("rejects %s without calling the setter", async (_name, input) => {
    const { saveLoyaltyProgram } = await import("./actions");
    const result = await saveLoyaltyProgram(input);
    expect(result.data).toBeNull();
    expect(result.error?.message).toBe("settings.loyalty.saveFailed");
    expect(setLoyaltyProgramRow).not.toHaveBeenCalled();
  });

  it("switching off needs no valid thresholds and falls back to 2/3/1", async () => {
    const { saveLoyaltyProgram } = await import("./actions");
    await saveLoyaltyProgram({ enabled: false });
    expect(setLoyaltyProgramRow).toHaveBeenCalledWith({ enabled: false, n: 2, k: 3, r: 1 });
  });

  it("replaces any server refusal with the fixed message", async () => {
    setLoyaltyProgramRow.mockResolvedValue({ data: null, error: { code: "forbidden", message: "raw db text" } });
    const { saveLoyaltyProgram } = await import("./actions");
    await expect(saveLoyaltyProgram({ enabled: true, n: 5, k: 3, r: 30 })).resolves.toEqual({
      data: null,
      error: { code: "forbidden", message: "settings.loyalty.saveFailed" },
    });
  });
});
