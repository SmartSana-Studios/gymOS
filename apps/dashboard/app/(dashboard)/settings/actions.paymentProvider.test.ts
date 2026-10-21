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
const connectGymPaymentCredentialsAsSupport = vi.fn();
const issueSupportStepUp = vi.fn();
const nudgeEmailOutbox = vi.fn(async () => true);
let supportGym: string | null = null;
let probeError: { message: string } | null = null;

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ rpc: async () => ({ data: supportGym, error: probeError }) })),
}));
vi.mock("@/services/session", () => ({ mapAndLog: vi.fn(async () => ({ code: "unknown", message: "mapped" })) }));
vi.mock("@/services/support-stepup", () => ({ issueSupportStepUp: (...a: unknown[]) => issueSupportStepUp(...a) }));
vi.mock("@/services/email-outbox-trigger", () => ({ nudgeEmailOutbox: () => nudgeEmailOutbox() }));
const disconnectGymPaymentCredentials = vi.fn();
const getGymPaymentConnectionStatus = vi.fn();

vi.mock("@/services/gym-payment-credentials", () => ({
  connectGymPaymentCredentials: (...args: unknown[]) => connectGymPaymentCredentials(...args),
  connectGymPaymentCredentialsAsSupport: (...args: unknown[]) => connectGymPaymentCredentialsAsSupport(...args),
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
  setRegistrationFee: vi.fn(),
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

describe("connectPaymentProvider as a live GymOS Support session (23.9)", () => {
  beforeEach(() => {
    supportGym = "gym-1";
    connectGymPaymentCredentials.mockReset();
    connectGymPaymentCredentialsAsSupport.mockReset();
    getGymPaymentConnectionStatus.mockReset();
    issueSupportStepUp.mockReset();
    nudgeEmailOutbox.mockClear();
    getGymPaymentConnectionStatus.mockResolvedValue({ data: { businessIdMasked: "•••• biz1", connectedAt: "2026-10-21T00:00:00Z", needsAttention: false }, error: null });
  });

  it("verifies the code into a step-up bound to the gym, then uses the support function, never the Owner one", async () => {
    issueSupportStepUp.mockResolvedValue("issued");
    connectGymPaymentCredentialsAsSupport.mockResolvedValue({ error: null });
    const { connectPaymentProvider } = await import("./actions");

    const result = await connectPaymentProvider({ ...VALID_INPUT, authCode: "123456" });

    expect(issueSupportStepUp).toHaveBeenCalledWith({ action: "support_payment_connection", subjectId: "gym-1", code: "123456" });
    expect(connectGymPaymentCredentialsAsSupport).toHaveBeenCalledWith("taramoney", VALID_INPUT);
    expect(connectGymPaymentCredentials).not.toHaveBeenCalled();
    expect(result.error).toBeNull();
    expect(nudgeEmailOutbox).toHaveBeenCalledTimes(1);
  });

  it("a wrong code stops before any write and before the support function", async () => {
    issueSupportStepUp.mockResolvedValue("invalid_code");
    const { connectPaymentProvider } = await import("./actions");

    const result = await connectPaymentProvider({ ...VALID_INPUT, authCode: "000000" });

    expect(result.data).toBeNull();
    expect(result.error?.code).toBe("invalid_code");
    expect(connectGymPaymentCredentialsAsSupport).not.toHaveBeenCalled();
    expect(nudgeEmailOutbox).not.toHaveBeenCalled();
  });

  it("an unavailable step-up (provider or database) is reported and nothing is written", async () => {
    issueSupportStepUp.mockResolvedValue("unavailable");
    const { connectPaymentProvider } = await import("./actions");

    const result = await connectPaymentProvider({ ...VALID_INPUT, authCode: "123456" });

    expect(result.error?.code).toBe("step_up_unavailable");
    expect(connectGymPaymentCredentialsAsSupport).not.toHaveBeenCalled();
  });

  it("a failed connect is returned as is and sends no e-mail nudge", async () => {
    issueSupportStepUp.mockResolvedValue("issued");
    connectGymPaymentCredentialsAsSupport.mockResolvedValue({ error: { code: "unknown", message: "boom" } });
    const { connectPaymentProvider } = await import("./actions");

    const result = await connectPaymentProvider({ ...VALID_INPUT, authCode: "123456" });

    expect(result.error?.message).toBe("boom");
    expect(nudgeEmailOutbox).not.toHaveBeenCalled();
  });

  it("an Owner session never reaches the step-up or the support function, even if it sends a code", async () => {
    supportGym = null;
    connectGymPaymentCredentials.mockResolvedValue({ error: null });
    const { connectPaymentProvider } = await import("./actions");

    await connectPaymentProvider({ ...VALID_INPUT, authCode: "123456" });

    expect(issueSupportStepUp).not.toHaveBeenCalled();
    expect(connectGymPaymentCredentialsAsSupport).not.toHaveBeenCalled();
    expect(connectGymPaymentCredentials).toHaveBeenCalledWith("taramoney", VALID_INPUT);
  });

  it("a failed session probe is returned, not treated as 'not support'", async () => {
    probeError = { message: "db down" };
    const { connectPaymentProvider } = await import("./actions");
    const result = await connectPaymentProvider(VALID_INPUT);
    probeError = null;
    expect(result.data).toBeNull();
    expect(result.error).not.toBeNull();
    expect(connectGymPaymentCredentials).not.toHaveBeenCalled();
    expect(connectGymPaymentCredentialsAsSupport).not.toHaveBeenCalled();
  });
});
