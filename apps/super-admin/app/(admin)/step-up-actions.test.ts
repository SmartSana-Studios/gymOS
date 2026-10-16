/** Story 22.7: step-up is verified server side, counted on a wrong code, locks at the threshold. */
import { beforeEach, describe, expect, it, vi } from "vitest";

const challengeAndVerify = vi.fn();
const listFactors = vi.fn();
const signOut = vi.fn(async () => ({ error: null }));
const adminRpc = vi.fn();
let allowed = true;

vi.mock("@/lib/authz", () => ({
  authorizePlatformAction: vi.fn(async () =>
    allowed
      ? { ok: true, actorId: "sa-1" }
      : { ok: false, error: { code: "permission_denied", message: "errors.permissionDenied" }, reason: "x" },
  ),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: {
      signOut: (...a: unknown[]) => signOut(...(a as [])),
      mfa: { listFactors: (...a: unknown[]) => listFactors(...a), challengeAndVerify: (...a: unknown[]) => challengeAndVerify(...a) },
    },
  })),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: (...a: unknown[]) => adminRpc(...a) }) }));
vi.mock("@/lib/i18n/get-request-locale", () => ({ getRequestLocale: vi.fn(async () => "en") }));
vi.mock("@/lib/i18n/get-server-translation", () => ({ getServerTranslation: vi.fn(async () => ({ t: (k: string) => k })) }));

beforeEach(() => {
  vi.clearAllMocks();
  allowed = true;
  listFactors.mockResolvedValue({ data: { totp: [{ id: "f1" }] }, error: null });
  challengeAndVerify.mockResolvedValue({ data: {}, error: null });
  adminRpc.mockImplementation(async (fn: string) =>
    fn === "stepup_issue"
      ? { data: "2026-10-16T12:00:00Z", error: null }
      : { data: [{ locked: false, attempts: 1, threshold: 5 }], error: null },
  );
});

describe("issueStepUp", () => {
  it("a non Super Admin is refused before any provider call", async () => {
    allowed = false;
    const { issueStepUp } = await import("./step-up-actions");
    const res = await issueStepUp({ action: "create_super_admin", subjectId: "a@b.c", code: "123456" });
    expect(res.error?.code).toBe("permission_denied");
    expect(challengeAndVerify).not.toHaveBeenCalled();
  });

  it("a correct code issues one grant bound to the action and lowercased subject", async () => {
    const { issueStepUp } = await import("./step-up-actions");
    const res = await issueStepUp({ action: "create_super_admin", subjectId: "New@Example.com", code: "123 456" });
    expect(res.data).toEqual({ issued: true });
    expect(adminRpc).toHaveBeenCalledWith("stepup_issue", { p_user: "sa-1", p_action: "create_super_admin", p_subject: "new@example.com" });
  });

  it("a wrong code records a failure (no code sent), issues nothing", async () => {
    challengeAndVerify.mockResolvedValue({ data: null, error: { message: "bad", code: "mfa_verification_failed" } });
    const { issueStepUp } = await import("./step-up-actions");
    const res = await issueStepUp({ action: "remove_super_admin_factor", subjectId: "f1", code: "000000" });
    expect(res.error?.code).toBe("invalid_code");
    expect(adminRpc).toHaveBeenCalledTimes(1);
    expect(adminRpc).toHaveBeenCalledWith("stepup_record_failure", { p_user: "sa-1" });
    expect(JSON.stringify(adminRpc.mock.calls)).not.toContain("000000");
  });

  it("a provider error is not a wrong code: nothing is counted", async () => {
    challengeAndVerify.mockResolvedValue({ data: null, error: { message: "network", code: "unexpected_failure" } });
    const { issueStepUp } = await import("./step-up-actions");
    const res = await issueStepUp({ action: "remove_super_admin_factor", subjectId: "f1", code: "000000" });
    expect(res.error?.code).toBe("unavailable");
    expect(adminRpc).not.toHaveBeenCalled();
  });

  it("the threshold failure comes back as a lock and signs the session out", async () => {
    challengeAndVerify.mockResolvedValue({ data: null, error: { message: "bad", code: "mfa_verification_failed" } });
    adminRpc.mockResolvedValue({ data: [{ locked: true, attempts: 5, threshold: 5 }], error: null });
    const { issueStepUp } = await import("./step-up-actions");
    const res = await issueStepUp({ action: "remove_super_admin_factor", subjectId: "f1", code: "000000" });
    expect(res.error?.code).toBe("account_locked");
    expect(signOut).toHaveBeenCalled();
  });

  it("a failed failure-counter write fails closed with permission_denied", async () => {
    challengeAndVerify.mockResolvedValue({ data: null, error: { message: "bad", code: "mfa_verification_failed" } });
    adminRpc.mockResolvedValue({ data: null, error: { message: "db down" } });
    const { issueStepUp } = await import("./step-up-actions");
    const res = await issueStepUp({ action: "remove_super_admin_factor", subjectId: "f1", code: "000000" });
    expect(res.error?.code).toBe("permission_denied");
    expect(res.data).toBeNull();
  });

  it("a malformed code or unknown action never reaches the provider", async () => {
    const { issueStepUp } = await import("./step-up-actions");
    expect((await issueStepUp({ action: "create_super_admin", subjectId: "a@b.c", code: "12" })).error?.code).toBe("invalid_code");
    expect(
      (await issueStepUp({ action: "billing.retry" as never, subjectId: "a", code: "123456" })).error?.code,
    ).toBe("invalid_code");
    expect(challengeAndVerify).not.toHaveBeenCalled();
  });
});
