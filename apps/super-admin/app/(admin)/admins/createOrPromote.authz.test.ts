/**
 * Story 22.4: createOrPromoteSuperAdmin checks the caller against the database at call time (not the
 * app_role claim) before the password step-up, the admin client or any RPC. The step-up itself is
 * unchanged.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const signIn = vi.fn();
const rpc = vi.fn();
const createAdminClientMock = vi.fn(() => ({}));
let allowed = true;

vi.mock("@/lib/authz", () => ({
  authorizePlatformAction: vi.fn(async () =>
    allowed
      ? { ok: true, actorId: "sa-1" }
      : { ok: false, error: { code: "permission_denied", message: "errors.permissionDenied" } },
  ),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    // A stale claim must not matter: getClaims would still say super_admin.
    auth: {
      getClaims: vi.fn(async () => ({ data: { claims: { app_role: "super_admin" } }, error: null })),
      getUser: vi.fn(async () => ({ data: { user: { email: "sa@example.com" } }, error: null })),
      signInWithPassword: (...a: unknown[]) => signIn(...a),
    },
    rpc: (...a: unknown[]) => rpc(...a),
  })),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => createAdminClientMock() }));
vi.mock("@/services/gyms", () => ({ mapAndLog: vi.fn(async () => ({ code: "unknown", message: "m" })) }));
vi.mock("@/lib/i18n/get-request-locale", () => ({ getRequestLocale: vi.fn(async () => "en") }));
vi.mock("@/lib/i18n/get-server-translation", () => ({ getServerTranslation: vi.fn(async () => ({ t: (k: string) => k })) }));
vi.mock("@/lib/super-admin-provisioning.mjs", () => ({
  createAuthUserWithTempPassword: vi.fn(),
  deleteAuthUserAndLog: vi.fn(),
  displayNameFromEmail: vi.fn(() => "x"),
  findUserByEmail: vi.fn(async () => null),
}));

beforeEach(() => {
  vi.clearAllMocks();
  allowed = true;
});

describe("createOrPromoteSuperAdmin live authorization", () => {
  it("a caller whose Super Admin flag was removed is denied even with a super_admin claim: no step-up, no admin client, no RPC", async () => {
    allowed = false;
    const { createOrPromoteSuperAdmin } = await import("./actions");

    const res = await createOrPromoteSuperAdmin({ email: "new@example.com", currentPassword: "pw-123456" });

    expect(res.data).toBeNull();
    expect(res.error?.code).toBe("permission_denied");
    expect(signIn).not.toHaveBeenCalled();
    expect(createAdminClientMock).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
});
