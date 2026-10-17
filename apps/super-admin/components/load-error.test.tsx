/** Pages render in parallel with the layout: a failed load after the session ended must go to login, not show an error. */
import { beforeEach, describe, expect, it, vi } from "vitest";

class Redirected extends Error {}
const redirect = vi.fn((to: string) => {
  throw new Redirected(to);
});
const authorize = vi.fn();

vi.mock("next/navigation", () => ({ redirect: (to: string) => redirect(to) }));
vi.mock("@/lib/authz", () => ({ authorizePlatformAction: (...a: unknown[]) => authorize(...a) }));
vi.mock("@/lib/i18n/get-request-locale", () => ({ getRequestLocale: vi.fn(async () => "en") }));
vi.mock("@/lib/i18n/get-server-translation", () => ({ getServerTranslation: vi.fn(async () => ({ t: (k: string) => k })) }));

import { LoadError } from "./load-error";
import { endsSession, loginRedirectFor } from "@/lib/auth-redirect";

beforeEach(() => vi.clearAllMocks());

describe("LoadError", () => {
  it.each([
    ["session_expired", "/auth/login?expired=1"],
    ["no_session", "/auth/login?expired=1"],
    ["account_locked", "/auth/login?expired=1"],
    ["aal2_required", "/auth/mfa"],
    ["not_super_admin", "/auth/login?denied=1"],
  ])("redirects to login when the session is gone (%s)", async (reason, to) => {
    authorize.mockResolvedValue({ ok: false, reason, error: { code: "permission_denied", message: "x" } });
    await expect(LoadError()).rejects.toBeInstanceOf(Redirected);
    expect(redirect).toHaveBeenCalledWith(to);
  });

  it("a backend that cannot answer is not a reason to sign the user out: it shows the load error", async () => {
    authorize.mockResolvedValue({ ok: false, reason: "authorization_unavailable", error: { code: "permission_denied", message: "x" } });
    const el = (await LoadError()) as { props: { children: string } };
    expect(redirect).not.toHaveBeenCalled();
    expect(el.props.children).toBe("common.loadError");
  });

  it("an authorization check that throws shows the load error too", async () => {
    authorize.mockRejectedValue(new Error("boom"));
    const el = (await LoadError()) as { props: { children: string } };
    expect(redirect).not.toHaveBeenCalled();
    expect(el.props.children).toBe("common.loadError");
  });

  it("shows the load error only for an authorized caller", async () => {
    authorize.mockResolvedValue({ ok: true, actorId: "sa-1" });
    const el = (await LoadError()) as { props: { children: string } };
    expect(redirect).not.toHaveBeenCalled();
    expect(el.props.children).toBe("common.loadError");
  });
});

describe("loginRedirectFor", () => {
  it("maps every denial reason the layout used to handle", () => {
    expect(loginRedirectFor("aal2_required")).toBe("/auth/mfa");
    expect(loginRedirectFor("session_expired")).toBe("/auth/login?expired=1");
    expect(loginRedirectFor("anything_else")).toBe("/auth/login");
    expect(endsSession("session_expired")).toBe(true);
    expect(endsSession("not_super_admin")).toBe(true);
    expect(endsSession("authorization_unavailable")).toBe(false);
  });
});
