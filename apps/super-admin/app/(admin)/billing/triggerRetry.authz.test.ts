/** Story 22.4: triggerRetry asks the live Super Admin check first; a denial has no side effect. */
import { beforeEach, describe, expect, it, vi } from "vitest";

const adminFrom = vi.fn();
const createAdminClientMock = vi.fn(() => ({ from: adminFrom }));
const sendEvolution = vi.fn();
let allowed = true;

vi.mock("@/lib/authz", () => ({
  authorizePlatformAction: vi.fn(async () =>
    allowed
      ? { ok: true, actorId: "sa-1" }
      : { ok: false, error: { code: "permission_denied", message: "errors.permissionDenied" } },
  ),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => createAdminClientMock() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => ({})) }));
vi.mock("@/services/gyms", () => ({ logGymLifecycleEvent: vi.fn(), mapAndLog: vi.fn(async () => ({ code: "unknown", message: "m" })) }));
vi.mock("@/lib/i18n/get-request-locale", () => ({ getRequestLocale: vi.fn(async () => "en") }));
vi.mock("@/lib/i18n/get-server-translation", () => ({ getServerTranslation: vi.fn(async () => ({ t: (k: string) => k })) }));
vi.mock("@/lib/messaging/EvolutionApiMessageProvider", () => ({ sendEvolutionApiMessage: (...a: unknown[]) => sendEvolution(...a) }));
vi.mock("@/lib/messaging/sendTwilioSms", () => ({ sendTwilioSms: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  allowed = true;
});

describe("triggerRetry live authorization", () => {
  it("a denied caller gets permission_denied; the service-role client is never created and nothing is sent", async () => {
    allowed = false;
    const { triggerRetry } = await import("./actions");

    const res = await triggerRetry("11111111-1111-4111-8111-111111111111");

    expect(res.error?.code).toBe("permission_denied");
    expect(createAdminClientMock).not.toHaveBeenCalled();
    expect(sendEvolution).not.toHaveBeenCalled();
  });
});
