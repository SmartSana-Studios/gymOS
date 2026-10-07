/**
 * Story 18.1: unit tests for the `saveRegistrationFee` Server Action --
 * exercises exactly what the action adds (Zod validation of a whole,
 * non-negative amount, then delegation to the service) without a real DB
 * call. Mirrors `actions.payNow.test.ts`'s mocking convention.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const setRegistrationFee = vi.fn();

vi.mock("@/services/gym-settings", () => ({
  ALLOWED_LOGO_MIME_TYPES: new Map(),
  MAX_LOGO_BYTES: 5 * 1024 * 1024,
  logGymSettingsChange: vi.fn(),
  regenerateQrCode: vi.fn(),
  setRegistrationFee: (...args: unknown[]) => setRegistrationFee(...args),
  updateGymSettings: vi.fn(),
  uploadGymLogo: vi.fn(),
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

vi.mock("@/lib/i18n/get-request-locale", () => ({
  getRequestLocale: vi.fn(async () => "en"),
}));

vi.mock("@/lib/i18n/get-server-translation", () => ({
  getServerTranslation: vi.fn(async () => ({ t: (key: string) => key })),
}));

beforeEach(() => {
  setRegistrationFee.mockReset().mockResolvedValue({ data: { ok: true }, error: null });
});

describe("saveRegistrationFee", () => {
  it("passes a valid whole amount to the service", async () => {
    const { saveRegistrationFee } = await import("./actions");

    const result = await saveRegistrationFee(5000);

    expect(setRegistrationFee).toHaveBeenCalledWith(5000);
    expect(result).toEqual({ data: { ok: true }, error: null });
  });

  it("accepts 0 (no registration fee)", async () => {
    const { saveRegistrationFee } = await import("./actions");

    await saveRegistrationFee(0);

    expect(setRegistrationFee).toHaveBeenCalledWith(0);
  });

  it.each([-1, 12.5, "5000", null, undefined, Number.NaN, 2147483648])(
    "rejects %s with a validation error, without calling the service",
    async (input) => {
      const { saveRegistrationFee } = await import("./actions");

      const result = await saveRegistrationFee(input);

      expect(setRegistrationFee).not.toHaveBeenCalled();
      expect(result.data).toBeNull();
      expect(result.error?.code).toBe("validation_error");
      expect(result.error?.message).toBe("settings.errors.registrationFeeInvalid");
    },
  );

  it("returns the service's error unchanged", async () => {
    setRegistrationFee.mockResolvedValue({ data: null, error: { code: "unknown", message: "boom" } });
    const { saveRegistrationFee } = await import("./actions");

    const result = await saveRegistrationFee(5000);

    expect(result).toEqual({ data: null, error: { code: "unknown", message: "boom" } });
  });
});
