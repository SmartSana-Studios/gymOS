/**
 * Story 22.5: enrollment, verification and removal run only in Server Actions that check the
 * live Super Admin gate and the session aal before any provider call.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const enroll = vi.fn();
const unenroll = vi.fn();
const challengeAndVerify = vi.fn();
const listFactorsMock = vi.fn();
const getAal = vi.fn();
const rpc = vi.fn();
const adminSignOut = vi.fn(async () => ({ error: null }));
const consumeStepUpMock = vi.fn();
let allowed = true;
let aalGate = true;
let stepUpOk = true;
let flagOn: unknown = false;
let flagError: unknown = null;

vi.mock("@/lib/authz", () => ({
  STEP_UP_REQUIRED_CODE: "step_up_required",
  consumeStepUp: (...a: unknown[]) => consumeStepUpMock(...a),
  authorizePlatformAction: vi.fn(async () =>
    allowed
      ? { ok: true, actorId: "sa-1" }
      : { ok: false, error: { code: "permission_denied", message: "errors.permissionDenied" }, reason: "aal2_required" },
  ),
  requireSuperAdminAal2: vi.fn(async () =>
    aalGate
      ? { ok: true, actorId: "sa-1" }
      : { ok: false, error: { code: "permission_denied", message: "errors.permissionDenied" }, reason: "aal2_required" },
  ),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getSession: async () => ({ data: { session: { access_token: "tok-1" } }, error: null }),
      mfa: {
        enroll: (...a: unknown[]) => enroll(...a),
        unenroll: (...a: unknown[]) => unenroll(...a),
        challengeAndVerify: (...a: unknown[]) => challengeAndVerify(...a),
        listFactors: (...a: unknown[]) => listFactorsMock(...a),
        getAuthenticatorAssuranceLevel: (...a: unknown[]) => getAal(...a),
      },
    },
    rpc: (...a: unknown[]) => rpc(...a),
  })),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: async () => ({ data: flagOn, error: flagError }),
    auth: { admin: { signOut: (...a: unknown[]) => (adminSignOut as (...x: unknown[]) => unknown)(...a) } },
  }),
}));
vi.mock("@/lib/i18n/get-request-locale", () => ({ getRequestLocale: vi.fn(async () => "en") }));
vi.mock("@/lib/i18n/get-server-translation", () => ({ getServerTranslation: vi.fn(async () => ({ t: (k: string) => k })) }));

function setup(opts: { verified: number; aal: "aal1" | "aal2"; all?: unknown[] }) {
  listFactorsMock.mockResolvedValue({
    data: { totp: Array.from({ length: opts.verified }, (_, i) => ({ id: `f${i + 1}` })), all: opts.all ?? [] },
    error: null,
  });
  getAal.mockResolvedValue({ data: { currentLevel: opts.aal }, error: null });
}

beforeEach(() => {
  vi.clearAllMocks();
  allowed = true;
  aalGate = true;
  stepUpOk = true;
  consumeStepUpMock.mockImplementation(async () => stepUpOk);
  adminSignOut.mockResolvedValue({ error: null });
  flagOn = false;
  flagError = null;
  rpc.mockResolvedValue({ data: "audit-id", error: null });
  enroll.mockResolvedValue({ data: { id: "new-f", totp: { qr_code: "data:image/svg+xml;utf8,<svg/>", secret: "SECRET" } }, error: null });
  unenroll.mockResolvedValue({ error: null });
  challengeAndVerify.mockResolvedValue({ data: {}, error: null });
});

describe("security actions", () => {
  it("a non Super Admin is refused before any provider call", async () => {
    allowed = false;
    setup({ verified: 0, aal: "aal1" });
    const { enrollFactor, verifyFactor, removeFactor } = await import("./actions");
    expect((await enrollFactor({})).error?.code).toBe("permission_denied");
    expect((await verifyFactor({ factorId: "f", code: "123456" })).error?.code).toBe("permission_denied");
    expect((await removeFactor({ factorId: "f" })).error?.code).toBe("permission_denied");
    expect(enroll).not.toHaveBeenCalled();
    expect(challengeAndVerify).not.toHaveBeenCalled();
    expect(unenroll).not.toHaveBeenCalled();
  });

  it("first factor at aal1 enrolls and writes exactly one audit row without a secret", async () => {
    setup({ verified: 0, aal: "aal1" });
    const { enrollFactor } = await import("./actions");
    const res = await enrollFactor({});
    expect(res.data?.factorId).toBe("new-f");
    expect(rpc).toHaveBeenCalledTimes(1);
    const [fn, args] = rpc.mock.calls[0];
    expect(fn).toBe("log_audit_event");
    expect(args.p_action_type).toBe("super_admin_mfa_enrolled");
    expect(JSON.stringify(args)).not.toContain("SECRET");
    expect(JSON.stringify(args)).not.toContain("svg");
  });

  it("second factor at aal1 is refused before the provider call", async () => {
    setup({ verified: 1, aal: "aal1" });
    const { enrollFactor } = await import("./actions");
    const res = await enrollFactor({});
    expect(res.error?.code).toBe("aal2_required"); // retro item 73: an actionable error, not a generic permission denial
    expect(res.error?.message).toBe("security.errors.verifyFirst");
    expect(enroll).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("second factor at aal2 enrolls", async () => {
    setup({ verified: 1, aal: "aal2" });
    const { enrollFactor } = await import("./actions");
    expect((await enrollFactor({})).data).not.toBeNull();
    expect(enroll).toHaveBeenCalledTimes(1);
  });

  it("a wrong code leaves the factor unverified and writes no audit row", async () => {
    setup({ verified: 0, aal: "aal1" });
    challengeAndVerify.mockResolvedValue({ data: null, error: { message: "bad" } });
    const { verifyFactor } = await import("./actions");
    const res = await verifyFactor({ factorId: "new-f", code: "000000" });
    expect(res.error?.code).toBe("invalid_code");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("a verified code writes one audit row with no code in it", async () => {
    setup({ verified: 0, aal: "aal1" });
    const { verifyFactor } = await import("./actions");
    expect((await verifyFactor({ factorId: "new-f", code: "123456" })).data?.verified).toBe(true);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0][1].p_action_type).toBe("super_admin_mfa_verified");
    expect(JSON.stringify(rpc.mock.calls[0][1])).not.toContain("123456");
  });

  it("a failed global sign-out is reported, not swallowed", async () => {
    setup({ verified: 2, aal: "aal2" });
    flagOn = true;
    adminSignOut.mockResolvedValue({ error: { message: "boom" } } as never);
    const { removeFactor } = await import("./actions");
    const res = await removeFactor({ factorId: "f1" });
    expect(res.data).toEqual({ removed: true, signedOut: false, signOutFailed: true, auditFailed: false });
  });

  it("an audit failure after the factor is gone still ends every session and is reported (retro item 58)", async () => {
    setup({ verified: 2, aal: "aal2" });
    flagOn = true;
    rpc.mockResolvedValue({ error: { code: "XX000" } });
    const { removeFactor } = await import("./actions");
    const res = await removeFactor({ factorId: "f1" });
    expect(res.error).toBeNull();
    expect(res.data).toEqual({ removed: true, signedOut: true, signOutFailed: false, auditFailed: true });
    expect(adminSignOut).toHaveBeenCalledWith("tok-1", "global");
  });

  it("removal at aal1 is refused", async () => {
    setup({ verified: 2, aal: "aal1" });
    const { removeFactor } = await import("./actions");
    expect((await removeFactor({ factorId: "f1" })).error?.code).toBe("permission_denied");
    expect(unenroll).not.toHaveBeenCalled();
  });

  it("removal at aal2 with two verified factors removes and audits", async () => {
    setup({ verified: 2, aal: "aal2" });
    flagOn = true;
    const { removeFactor } = await import("./actions");
    const res = await removeFactor({ factorId: "f1" });
    expect(res.data).toEqual({ removed: true, signedOut: true, signOutFailed: false, auditFailed: false });
    expect(unenroll).toHaveBeenCalledWith({ factorId: "f1" });
    expect(rpc.mock.calls[0][1].p_action_type).toBe("super_admin_mfa_removed");
    expect(consumeStepUpMock).toHaveBeenCalledWith("sa-1", "remove_super_admin_factor", "f1");
    expect(adminSignOut).toHaveBeenCalledWith("tok-1", "global");
  });

  it("a concurrent removal that slips past the count is stopped by the database and reported as last_factor (0129)", async () => {
    setup({ verified: 2, aal: "aal2" });
    flagOn = true;
    unenroll.mockResolvedValue({ error: { message: "last_verified_factor: a Super Admin must keep one verified authenticator" } });
    const { removeFactor } = await import("./actions");
    const res = await removeFactor({ factorId: "f1" });
    expect(res.error?.code).toBe("last_factor");
    expect(rpc).not.toHaveBeenCalled(); // nothing was removed, so nothing is audited as removed
    expect(adminSignOut).not.toHaveBeenCalled();
  });

  it("GoTrue hides the trigger text: a failed unenroll of the only verified factor is still reported as last_factor", async () => {
    // two verified factors when we checked, one left when we look again (a concurrent removal got there first)
    setup({ verified: 2, aal: "aal2" });
    flagOn = true;
    unenroll.mockResolvedValue({ error: { message: "Database error deleting factor" } });
    listFactorsMock.mockResolvedValueOnce({ data: { totp: [{ id: "f1" }, { id: "f2" }], all: [] }, error: null });
    listFactorsMock.mockResolvedValueOnce({ data: { totp: [{ id: "f1" }], all: [] }, error: null });
    const { removeFactor } = await import("./actions");
    const res = await removeFactor({ factorId: "f1" });
    expect(res.error?.code).toBe("last_factor");
  });

  it("any other unenroll failure stays a generic remove_failed", async () => {
    setup({ verified: 2, aal: "aal2" });
    flagOn = true;
    unenroll.mockResolvedValue({ error: { message: "network" } });
    const { removeFactor } = await import("./actions");
    expect((await removeFactor({ factorId: "f1" })).error?.code).toBe("remove_failed");
  });

  it("removing a verified factor without a fresh step-up returns step_up_required and does not unenroll (22.7)", async () => {
    setup({ verified: 2, aal: "aal2" });
    flagOn = true;
    stepUpOk = false;
    const { removeFactor } = await import("./actions");
    expect((await removeFactor({ factorId: "f1" })).error?.code).toBe("step_up_required");
    expect(unenroll).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("removing the last verified factor with the flag on is refused with no change", async () => {
    setup({ verified: 1, aal: "aal2" });
    flagOn = true;
    const { removeFactor } = await import("./actions");
    expect((await removeFactor({ factorId: "f1" })).error?.code).toBe("last_factor");
    expect(unenroll).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("the aal gate (flag on, aal1) refuses every action before the provider", async () => {
    aalGate = false;
    setup({ verified: 0, aal: "aal1" });
    const { enrollFactor, removeFactor } = await import("./actions");
    expect((await enrollFactor({})).error?.code).toBe("permission_denied");
    expect((await removeFactor({ factorId: "f1" })).error?.code).toBe("permission_denied");
    expect(enroll).not.toHaveBeenCalled();
    expect(unenroll).not.toHaveBeenCalled();
  });

  it("flag on, aal1 session calls enroll: refused before the provider and nothing is written (22.6)", async () => {
    aalGate = false;
    flagOn = true;
    setup({ verified: 2, aal: "aal1" });
    const { enrollFactor } = await import("./actions");
    const res = await enrollFactor({});
    expect(res.error?.code).toBe("permission_denied");
    expect(enroll).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("removal fails closed when the flag read errors or is not a boolean", async () => {
    setup({ verified: 2, aal: "aal2" });
    const { removeFactor } = await import("./actions");
    flagError = { message: "boom" };
    expect((await removeFactor({ factorId: "f1" })).error?.code).toBe("permission_denied");
    flagError = null;
    flagOn = "yes";
    expect((await removeFactor({ factorId: "f1" })).error?.code).toBe("permission_denied");
    expect(unenroll).not.toHaveBeenCalled();
  });

  it("an unverified factor is removable at aal1", async () => {
    setup({ verified: 0, aal: "aal1", all: [{ id: "u1", factor_type: "totp", status: "unverified" }] });
    const { removeFactor } = await import("./actions");
    expect((await removeFactor({ factorId: "u1" })).data?.removed).toBe(true);
    expect(consumeStepUpMock).not.toHaveBeenCalled();
    expect(adminSignOut).not.toHaveBeenCalled();
    expect(unenroll).toHaveBeenCalledWith({ factorId: "u1" });
  });

  it("verify audit failure returns audit_failed", async () => {
    setup({ verified: 0, aal: "aal1" });
    rpc.mockResolvedValue({ data: null, error: { code: "x" } });
    const { verifyFactor } = await import("./actions");
    expect((await verifyFactor({ factorId: "new-f", code: "123456" })).error?.code).toBe("audit_failed");
  });

  it("remove audit failure no longer returns an error: the factor is gone, so it is reported as removed with auditFailed", async () => {
    setup({ verified: 2, aal: "aal2" });
    rpc.mockResolvedValue({ data: null, error: { code: "x" } });
    const { removeFactor } = await import("./actions");
    const res = await removeFactor({ factorId: "f1" });
    expect(res.error).toBeNull();
    expect(res.data?.auditFailed).toBe(true);
  });

  it("enroll audit failure unenrolls the new factor and returns audit_failed", async () => {
    setup({ verified: 0, aal: "aal1" });
    rpc.mockResolvedValue({ data: null, error: { code: "x" } });
    const { enrollFactor } = await import("./actions");
    expect((await enrollFactor({})).error?.code).toBe("audit_failed");
    expect(unenroll).toHaveBeenCalledWith({ factorId: "new-f" });
  });

  it("enroll cleans stale unverified factors first", async () => {
    setup({
      verified: 0,
      aal: "aal1",
      all: [
        { id: "u1", factor_type: "totp", status: "unverified" },
        { id: "v1", factor_type: "totp", status: "verified" },
      ],
    });
    const { enrollFactor } = await import("./actions");
    expect((await enrollFactor({})).data).not.toBeNull();
    expect(unenroll).toHaveBeenCalledTimes(1);
    expect(unenroll).toHaveBeenCalledWith({ factorId: "u1" });
    expect(unenroll.mock.invocationCallOrder[0]).toBeLessThan(enroll.mock.invocationCallOrder[0]);
  });
});
