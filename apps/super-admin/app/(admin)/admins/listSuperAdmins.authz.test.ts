/** Story 22.4: listSuperAdmins is denied before the RPC or the admin client resolve any email. */
import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
const createAdminClientMock = vi.fn(() => ({ auth: { admin: { getUserById: vi.fn() } } }));

vi.mock("@/lib/authz", () => ({
  authorizePlatformAction: vi.fn(async () => ({
    ok: false,
    error: { code: "permission_denied", message: "errors.permissionDenied" },
  })),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => ({ rpc: (...a: unknown[]) => rpc(...a) })) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => createAdminClientMock() }));
vi.mock("@/services/gyms", () => ({ mapAndLog: vi.fn(async () => ({ code: "unknown", message: "m" })) }));
vi.mock("@/lib/i18n/get-request-locale", () => ({ getRequestLocale: vi.fn(async () => "en") }));
vi.mock("@/lib/i18n/get-server-translation", () => ({ getServerTranslation: vi.fn(async () => ({ t: (k: string) => k })) }));
vi.mock("@/lib/super-admin-provisioning.mjs", () => ({
  createAuthUserWithTempPassword: vi.fn(),
  deleteAuthUserAndLog: vi.fn(),
  displayNameFromEmail: vi.fn(),
  findUserByEmail: vi.fn(),
}));

beforeEach(() => vi.clearAllMocks());

describe("listSuperAdmins live authorization", () => {
  it("a denied actor gets permission_denied; no RPC and no admin client", async () => {
    const { listSuperAdmins } = await import("./actions");

    const res = await listSuperAdmins();

    expect(res.data).toBeNull();
    expect(res.error?.code).toBe("permission_denied");
    expect(rpc).not.toHaveBeenCalled();
    expect(createAdminClientMock).not.toHaveBeenCalled();
  });
});
