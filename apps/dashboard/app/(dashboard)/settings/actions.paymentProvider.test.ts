/**
 * Story 4.13 (Task 4/6, AC #1): unit tests for the `connectPaymentProvider`/
 * `disconnectPaymentProvider` Server Actions. Mocks the collaborators
 * (`@/services/gym-payment-credentials`, locale/translation) so this suite
 * exercises exactly what these actions add -- Zod validation, the RPC call,
 * and the re-fetch-status-after-connect behavior -- without a real DB call.
 * `@/services/gym-settings` is stubbed only so the module resolves (matches
 * `actions.sendMemberInvite.test.ts`'s established precedent).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const connectGymPaymentCredentials = vi.fn();
const disconnectGymPaymentCredentials = vi.fn();
const getGymPaymentConnectionStatus = vi.fn();

vi.mock("@/services/gym-payment-credentials", () => ({
  connectGymPaymentCredentials: (...args: unknown[]) => connectGymPaymentCredentials(...args),
  disconnectGymPaymentCredentials: (...args: unknown[]) => disconnectGymPaymentCredentials(...args),
  getGymPaymentConnectionStatus: (...args: unknown[]) => getGymPaymentConnectionStatus(...args),
  // Real implementation, not a mock -- `connectPaymentProvider`'s
  // re-fetch-failure fallback (review fix, Story 4.13) needs actual masking
  // behavior, and it has no external dependencies of its own to stub out.
  maskBusinessId: (businessId: string) => {
    const trimmed = businessId.trim();
    return trimmed.length > 4 ? `•••• ${trimmed.slice(-4)}` : "••••";
  },
}));

vi.mock("@/services/gym-settings", () => ({
  ALLOWED_LOGO_MIME_TYPES: new Map(),
  MAX_LOGO_BYTES: 5 * 1024 * 1024,
  logGymSettingsChange: vi.fn(),
  regenerateQrCode: vi.fn(),
  updateGymSettings: vi.fn(),
  uploadGymLogo: vi.fn(),
}));

vi.mock("@/lib/i18n/get-request-locale", () => ({
  getRequestLocale: vi.fn(async () => "en"),
}));

vi.mock("@/lib/i18n/get-server-translation", () => ({
  getServerTranslation: vi.fn(async () => ({ t: (key: string) => key })),
}));

const VALID_INPUT = { apiKey: "key-1", businessId: "biz-1", webhookSecret: "secret-1" };

describe("connectPaymentProvider", () => {
  beforeEach(() => {
    connectGymPaymentCredentials.mockReset();
    getGymPaymentConnectionStatus.mockReset();
  });

  it("returns a validation error for missing fields, without calling the RPC", async () => {
    const { connectPaymentProvider } = await import("./actions");

    const result = await connectPaymentProvider({ apiKey: "", businessId: "biz-1", webhookSecret: "secret-1" });

    expect(connectGymPaymentCredentials).not.toHaveBeenCalled();
    expect(result.data).toBeNull();
    expect(result.error?.code).toBe("validation_error");
  });

  it("calls connectGymPaymentCredentials with provider 'taramoney' and the parsed input", async () => {
    connectGymPaymentCredentials.mockResolvedValue({ error: null });
    getGymPaymentConnectionStatus.mockResolvedValue({
      data: { businessIdMasked: "•••• biz1", connectedAt: "2026-08-17T00:00:00Z" },
      error: null,
    });
    const { connectPaymentProvider } = await import("./actions");

    await connectPaymentProvider(VALID_INPUT);

    expect(connectGymPaymentCredentials).toHaveBeenCalledWith("taramoney", VALID_INPUT);
  });

  it("returns the freshly re-fetched masked status on success, not the raw input", async () => {
    connectGymPaymentCredentials.mockResolvedValue({ error: null });
    getGymPaymentConnectionStatus.mockResolvedValue({
      data: { businessIdMasked: "•••• biz1", connectedAt: "2026-08-17T00:00:00Z" },
      error: null,
    });
    const { connectPaymentProvider } = await import("./actions");

    const result = await connectPaymentProvider(VALID_INPUT);

    expect(result).toEqual({
      data: { status: { businessIdMasked: "•••• biz1", connectedAt: "2026-08-17T00:00:00Z" } },
      error: null,
    });
  });

  it("propagates a real RPC error (e.g. non-owner) without calling getGymPaymentConnectionStatus", async () => {
    connectGymPaymentCredentials.mockResolvedValue({ error: { code: "unknown", message: "permission denied" } });
    const { connectPaymentProvider } = await import("./actions");

    const result = await connectPaymentProvider(VALID_INPUT);

    expect(getGymPaymentConnectionStatus).not.toHaveBeenCalled();
    expect(result.data).toBeNull();
    expect(result.error?.message).toBe("permission denied");
  });

  it("review fix (Story 4.13): a failed post-connect status re-fetch must not be reported as a connect failure -- the write already succeeded, so it falls back to a status derived from the submitted input", async () => {
    connectGymPaymentCredentials.mockResolvedValue({ error: null });
    getGymPaymentConnectionStatus.mockResolvedValue({ data: null, error: { code: "unknown", message: "boom" } });
    const { connectPaymentProvider } = await import("./actions");

    const result = await connectPaymentProvider(VALID_INPUT);

    expect(result.error).toBeNull();
    expect(result.data?.status.businessIdMasked).toBe("•••• iz-1");
  });

  it("review fix (Story 4.13): same fallback applies when the re-fetch returns no rows at all", async () => {
    connectGymPaymentCredentials.mockResolvedValue({ error: null });
    getGymPaymentConnectionStatus.mockResolvedValue({ data: null, error: null });
    const { connectPaymentProvider } = await import("./actions");

    const result = await connectPaymentProvider(VALID_INPUT);

    expect(result.error).toBeNull();
    expect(result.data?.status.businessIdMasked).toBe("•••• iz-1");
  });
});

describe("disconnectPaymentProvider", () => {
  beforeEach(() => {
    disconnectGymPaymentCredentials.mockReset();
  });

  it("calls disconnectGymPaymentCredentials with provider 'taramoney' and returns ok on success", async () => {
    disconnectGymPaymentCredentials.mockResolvedValue({ error: null });
    const { disconnectPaymentProvider } = await import("./actions");

    const result = await disconnectPaymentProvider();

    expect(disconnectGymPaymentCredentials).toHaveBeenCalledWith("taramoney");
    expect(result).toEqual({ data: { ok: true }, error: null });
  });

  it("propagates a real RPC error unchanged", async () => {
    disconnectGymPaymentCredentials.mockResolvedValue({ error: { code: "unknown", message: "boom" } });
    const { disconnectPaymentProvider } = await import("./actions");

    const result = await disconnectPaymentProvider();

    expect(result).toEqual({ data: null, error: { code: "unknown", message: "boom" } });
  });
});
