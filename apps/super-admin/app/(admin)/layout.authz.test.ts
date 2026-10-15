/** Story 22.4: the (admin) layout guard is the live check, not the app_role claim. */
import { describe, expect, it, vi } from "vitest";

class Redirected extends Error {}
const redirect = vi.fn((to: string) => {
  throw new Redirected(to);
});

vi.mock("next/navigation", () => ({ redirect: (to: string) => redirect(to) }));
vi.mock("next/link", () => ({ default: () => null }));
const authorizePlatformAction = vi.fn(async (): Promise<Record<string, unknown>> => ({
  ok: false,
  error: { code: "permission_denied", message: "errors.permissionDenied" },
}));
vi.mock("@/lib/authz", () => ({ authorizePlatformAction: () => authorizePlatformAction() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    // A stale super_admin claim must not get the caller in.
    auth: { getClaims: vi.fn(async () => ({ data: { claims: { app_role: "super_admin" } }, error: null })) },
  })),
}));
vi.mock("@/lib/i18n/get-request-locale", () => ({ getRequestLocale: vi.fn(async () => "en") }));
vi.mock("@/lib/i18n/get-server-translation", () => ({ getServerTranslation: vi.fn(async () => ({ t: (k: string) => k })) }));
vi.mock("@/components/AdminNavLink", () => ({ AdminNavLink: () => null }));
vi.mock("@/components/LanguageToggle", () => ({ LanguageToggle: () => null }));
vi.mock("@/components/ThemeToggle", () => ({ ThemeToggle: () => null }));
vi.mock("@/components/logout-button", () => ({ LogoutButton: () => null }));
vi.mock("@/components/MobileNavMenu", () => ({ MobileNavMenu: () => null }));

describe("(admin) layout live authorization", () => {
  it("redirects to /auth/login when the live check denies, despite a super_admin claim", async () => {
    const mod = await import("./layout");
    const suspense = mod.default({ children: null }) as { props: { children: { type: (p: unknown) => Promise<unknown>; props: unknown } } };
    const inner = suspense.props.children;

    await expect(inner.type(inner.props)).rejects.toBeInstanceOf(Redirected);
    expect(redirect).toHaveBeenCalledWith("/auth/login");
  });

  it("sends an aal1 session (reason aal2_required) to the second-factor prompt, not a login loop", async () => {
    redirect.mockClear();
    authorizePlatformAction.mockResolvedValueOnce({
      ok: false,
      reason: "aal2_required",
      error: { code: "permission_denied", message: "errors.permissionDenied" },
    });
    const mod = await import("./layout");
    const suspense = mod.default({ children: null }) as { props: { children: { type: (p: unknown) => Promise<unknown>; props: unknown } } };
    const inner = suspense.props.children;
    await expect(inner.type(inner.props)).rejects.toBeInstanceOf(Redirected);
    expect(redirect).toHaveBeenCalledWith("/auth/mfa");
  });
});
