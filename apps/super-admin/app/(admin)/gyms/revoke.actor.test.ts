/** revokeGymAccess: the actor id is the authenticated caller, never a client-supplied value. */
import { beforeEach, describe, expect, it, vi } from "vitest";

const revokeGymDataAccess = vi.fn(async () => ({ data: { revokedCount: 1 }, error: null }));

vi.mock("@/lib/authz-action", () => ({ authorizeOrRedirect: vi.fn(async () => ({ ok: true, actorId: "00000000-0000-4000-8000-0000000000a1" })) }));
vi.mock("@/lib/i18n/get-request-locale", () => ({ getRequestLocale: vi.fn(async () => "en") }));
vi.mock("@/lib/i18n/get-server-translation", () => ({ getServerTranslation: vi.fn(async () => ({ t: (k: string) => k })) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/services/gyms", () => ({
  revokeGymDataAccess: (...a: unknown[]) => (revokeGymDataAccess as unknown as (...x: unknown[]) => unknown)(...a),
  mapAndLog: vi.fn(),
}));

import { revokeGymAccess } from "./actions";

const GYM = "00000000-0000-4000-8000-000000000001";
const ME = "00000000-0000-4000-8000-0000000000a1";
const OTHER = "00000000-0000-4000-8000-0000000000b2";

beforeEach(() => revokeGymDataAccess.mockClear());

describe("revokeGymAccess actor", () => {
  it("refuses an actor id that is not the signed-in caller, before touching anything", async () => {
    const res = await revokeGymAccess(GYM, OTHER, { reason: "cleanup of access" });
    expect(res.error?.code).toBe("permission_denied");
    expect(revokeGymDataAccess).not.toHaveBeenCalled();
  });
  it("accepts the signed-in caller's own id", async () => {
    const res = await revokeGymAccess(GYM, ME, { reason: "cleanup of access" });
    expect(res.error).toBeNull();
    expect(revokeGymDataAccess).toHaveBeenCalledWith(GYM, ME, "cleanup of access");
  });
});
