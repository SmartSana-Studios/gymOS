/**
 * Story 11.7 (Task 6): unit tests for the `payNow`/`payNowWithHostedCheckoutLink`
 * Server Actions -- exercises exactly what these actions add (Zod
 * validation of the optional `tierId`/`interval` override, then delegation)
 * without a real DB call. Mirrors `actions.paymentProvider.test.ts`'s
 * established mocking convention for this same file.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const initiateSaasBillingPayment = vi.fn();
const createSaasBillingHostedCheckoutLink = vi.fn();

vi.mock("@/services/billing", () => ({
  getGymBillingInfo: vi.fn(),
  initiateSaasBillingPayment: (...args: unknown[]) => initiateSaasBillingPayment(...args),
  createSaasBillingHostedCheckoutLink: (...args: unknown[]) => createSaasBillingHostedCheckoutLink(...args),
  updateOwnerNotificationEmail: vi.fn(),
}));

vi.mock("@/services/gym-settings", () => ({
  ALLOWED_LOGO_MIME_TYPES: new Map(),
  MAX_LOGO_BYTES: 5 * 1024 * 1024,
  logGymSettingsChange: vi.fn(),
  regenerateQrCode: vi.fn(),
  updateGymSettings: vi.fn(),
  uploadGymLogo: vi.fn(),
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
  initiateSaasBillingPayment.mockReset().mockResolvedValue({ data: { paymentId: "payment-1" }, error: null });
  createSaasBillingHostedCheckoutLink.mockReset().mockResolvedValue({
    data: { paymentId: "payment-1", checkoutUrl: "https://pay.taramoney.com/link/xyz" },
    error: null,
  });
});

describe("payNow", () => {
  it("passes phoneNumber and the optional tierId/interval override through to the service function", async () => {
    const { payNow } = await import("./actions");
    await payNow({ phoneNumber: "+237600000000", tierId: "3fa85f64-5717-4562-b3fc-2c963f66afa6", interval: "annual" });

    expect(initiateSaasBillingPayment).toHaveBeenCalledWith(
      "+237600000000",
      "3fa85f64-5717-4562-b3fc-2c963f66afa6",
      "annual",
    );
  });

  it("passes undefined tierId/interval when neither override is provided", async () => {
    const { payNow } = await import("./actions");
    await payNow({ phoneNumber: "+237600000000" });

    expect(initiateSaasBillingPayment).toHaveBeenCalledWith("+237600000000", undefined, undefined);
  });

  it("rejects an invalid tierId (not a uuid) before ever calling the service function", async () => {
    const { payNow } = await import("./actions");
    const result = await payNow({ phoneNumber: "+237600000000", tierId: "not-a-uuid" });

    expect(result.error?.code).toBe("validation_error");
    expect(initiateSaasBillingPayment).not.toHaveBeenCalled();
  });

  it("rejects a malformed phoneNumber before ever calling the service function", async () => {
    const { payNow } = await import("./actions");
    const result = await payNow({ phoneNumber: "not-a-phone" });

    expect(result.error?.code).toBe("validation_error");
    expect(initiateSaasBillingPayment).not.toHaveBeenCalled();
  });
});

describe("payNowWithHostedCheckoutLink", () => {
  it("passes the optional tierId/interval override through, with no phoneNumber", async () => {
    const { payNowWithHostedCheckoutLink } = await import("./actions");
    await payNowWithHostedCheckoutLink({ tierId: "3fa85f64-5717-4562-b3fc-2c963f66afa6", interval: "monthly" });

    expect(createSaasBillingHostedCheckoutLink).toHaveBeenCalledWith("3fa85f64-5717-4562-b3fc-2c963f66afa6", "monthly");
  });

  it("passes undefined for both when no override is provided", async () => {
    const { payNowWithHostedCheckoutLink } = await import("./actions");
    await payNowWithHostedCheckoutLink({});

    expect(createSaasBillingHostedCheckoutLink).toHaveBeenCalledWith(undefined, undefined);
  });

  it("rejects an invalid interval value before ever calling the service function", async () => {
    const { payNowWithHostedCheckoutLink } = await import("./actions");
    const result = await payNowWithHostedCheckoutLink({ interval: "weekly" });

    expect(result.error?.code).toBe("validation_error");
    expect(createSaasBillingHostedCheckoutLink).not.toHaveBeenCalled();
  });

  it("returns the checkoutUrl on success", async () => {
    const { payNowWithHostedCheckoutLink } = await import("./actions");
    const result = await payNowWithHostedCheckoutLink({});

    expect(result).toEqual({ data: { paymentId: "payment-1", checkoutUrl: "https://pay.taramoney.com/link/xyz" }, error: null });
  });
});
