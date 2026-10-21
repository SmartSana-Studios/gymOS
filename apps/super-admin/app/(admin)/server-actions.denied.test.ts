/** Story 22 retro item 53: with the gate denying, no gated Server Action reaches a service or a database client. */
import { describe, expect, it, vi } from "vitest";

const touched: string[] = [];
const trap = (label: string) =>
  new Proxy({}, {
    get: (_t, key) => {
      if (key === "then" || key === "__esModule") return undefined;
      return (..._a: unknown[]) => {
        touched.push(`${label}.${String(key)}`);
        throw new Error(`${label}.${String(key)} reached after a denial`);
      };
    },
  });

class Redirected extends Error {}
const redirect = vi.fn((to: string) => {
  throw new Redirected(to);
});
let denial = "authorization_unavailable";
vi.mock("next/navigation", () => ({ redirect: (to: string) => redirect(to) }));
vi.mock("@/lib/authz", () => ({
  authorizePlatformAction: vi.fn(async () => ({ ok: false, error: { code: "permission_denied", message: "denied" }, reason: denial })),
}));
vi.mock("@/lib/supabase/server", () => trap("supabase/server"));
vi.mock("@/lib/supabase/admin", () => trap("supabase/admin"));
vi.mock("@/services/gyms", () => trap("services/gyms"));
vi.mock("@/services/tiers", () => trap("services/tiers"));
vi.mock("@/services/payment-providers", () => trap("services/payment-providers"));
vi.mock("@/services/messaging-provider-config", () => trap("services/messaging-provider-config"));
vi.mock("@/lib/i18n/get-request-locale", () => ({ getRequestLocale: vi.fn(async () => "en") }));
vi.mock("@/lib/i18n/get-server-translation", () => ({ getServerTranslation: vi.fn(async () => ({ t: (k: string) => k })) }));

const GYM = "00000000-0000-4000-8000-000000000001";
const ACTOR = "00000000-0000-4000-8000-000000000002";

describe("a denied gate stops every gated Server Action before any work", () => {
  const cases: [string, () => Promise<{ error: { code: string } | null }>][] = [];
  const add = (name: string, load: () => Promise<Record<string, unknown>>, fn: string, args: unknown[]) =>
    cases.push([name, async () => (await load())[fn] instanceof Function ? ((await load())[fn] as (...a: unknown[]) => Promise<{ error: { code: string } | null }>)(...args) : Promise.reject(new Error(`${fn} missing`))]);

  const gyms = () => import("./gyms/actions");
  const billing = () => import("./billing/actions");
  const tiers = () => import("./tiers/actions");
  add("suspendGym", gyms, "suspendGym", [GYM, { reason: "x" }]);
  add("deactivateGym", gyms, "deactivateGym", [GYM, { reason: "x" }]);
  add("reinstateGym", gyms, "reinstateGym", [GYM, { reason: "x" }]);
  add("changeGymTier", gyms, "changeGymTier", [GYM, { tierId: GYM }]);
  add("overrideGymCap", gyms, "overrideGymCap", [GYM, { capOverride: 5, reason: "x" }]);
  add("escalateGymAccess", gyms, "escalateGymAccess", [GYM, { reason: "x" }]);
  add("revokeGymAccess", gyms, "revokeGymAccess", [GYM, ACTOR, { reason: "x" }]);
  add("changeGymCategory", gyms, "changeGymCategory", [GYM, { category: "gym" }]);
  add("markPaymentReceived", billing, "markPaymentReceived", [GYM]);
  add("applyCredit", billing, "applyCredit", [GYM, { days: 3, reason: "x" }]);
  add("createTier", tiers, "createTier", [{}]);
  add("editTier", tiers, "editTier", [GYM, {}]);
  add("deleteTier", tiers, "deleteTier", [GYM]);
  add("updateLanguagePreference", () => import("./actions"), "updateLanguagePreference", ["fr"]);
  add("updateMessagingInstance", () => import("./messaging/actions"), "updateMessagingInstance", [{}]);
  add("setActivePaymentProvider", () => import("./payment-providers/actions"), "setActivePaymentProvider", [{}]);
  const support = () => import("./support/actions");
  add("listSupportAccounts", support, "listSupportAccounts", []);
  add("createSupportAccount", support, "createSupportAccount", [{ displayName: "A", email: "a@gymosapps.com" }]);
  add("sendSupportInvite", support, "sendSupportInvite", [ACTOR]);
  add("listSupportAssignments", support, "listSupportAssignments", []);
  add("listAssignableGyms", support, "listAssignableGyms", []);
  add("assignSupport", support, "assignSupport", [{ userId: ACTOR, gymId: ACTOR, reason: "valid reason" }]);
  add("confirmSupportAssignment", support, "confirmSupportAssignment", [{ assignmentId: ACTOR, reason: "valid reason" }]);
  add("unassignSupport", support, "unassignSupport", [{ assignmentId: ACTOR, reason: "valid reason" }]);
  add("deactivateSupportAccount", support, "deactivateSupportAccount", [{ userId: ACTOR, reason: "valid reason" }]);
  add("removeSupportAccount", support, "removeSupportAccount", [{ userId: ACTOR, reason: "valid reason" }]);

  it.each(cases)("%s returns permission_denied and touches nothing when authorization is unavailable", async (_name, run) => {
    denial = "authorization_unavailable";
    touched.length = 0;
    const res = await run();
    expect(res.error?.code).toBe("permission_denied");
    expect(touched).toEqual([]);
    expect(redirect).not.toHaveBeenCalled();
  });

  it.each(cases)("%s redirects to login when the session has ended, and touches nothing", async (_name, run) => {
    for (const [reason, to] of [["session_expired", "/auth/login?expired=1"], ["no_session", "/auth/login?expired=1"], ["aal2_required", "/auth/mfa"], ["not_super_admin", "/auth/login?denied=1"]] as const) {
      denial = reason;
      touched.length = 0;
      redirect.mockClear();
      await expect(run()).rejects.toBeInstanceOf(Redirected);
      expect(redirect).toHaveBeenCalledWith(to);
      expect(touched).toEqual([]);
    }
  });
});
