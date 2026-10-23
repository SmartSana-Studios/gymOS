/**
 * Story 23.3: `saveAllowGymosSupport` Server Action.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const setAllowGymosSupportRow = vi.fn();

vi.mock("@/services/gym-settings", () => ({
  ALLOWED_LOGO_MIME_TYPES: new Map(),
  MAX_LOGO_BYTES: 5 * 1024 * 1024,
  getGymosSupportStatus: vi.fn(),
  setAllowGymosSupport: (...a: unknown[]) => setAllowGymosSupportRow(...a),
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

import { saveAllowGymosSupport } from "./actions";

beforeEach(() => {
  setAllowGymosSupportRow.mockReset().mockResolvedValue({ data: { ok: true }, error: null });
});

describe("saveAllowGymosSupport", () => {
  it.each(["true", 1, null, undefined])("rejects non-boolean %s without calling the service", async (input) => {
    const res = await saveAllowGymosSupport(input);
    expect(res.error?.code).toBe("validation_error");
    expect(setAllowGymosSupportRow).not.toHaveBeenCalled();
  });

  it("passes a boolean through", async () => {
    await expect(saveAllowGymosSupport(false)).resolves.toEqual({ data: { ok: true }, error: null });
    expect(setAllowGymosSupportRow).toHaveBeenCalledWith(false);
  });

  it("maps a service error to the fixed message", async () => {
    setAllowGymosSupportRow.mockResolvedValue({ data: null, error: { code: "forbidden", message: "raw" } });
    const res = await saveAllowGymosSupport(true);
    expect(res.data).toBeNull();
    expect(res.error).toEqual({ code: "forbidden", message: "settings.gymosSupport.saveFailed" });
  });
});
