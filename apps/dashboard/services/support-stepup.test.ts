/** Story 23.9: the support step-up is issued only after a fresh authenticator code is verified server side. */
import { beforeEach, describe, expect, it, vi } from "vitest";

const challengeAndVerify = vi.fn();
const listFactors = vi.fn();
const adminRpc = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getClaims: async () => ({ data: { claims: { sub: "support-1" } } }),
      mfa: { listFactors: () => listFactors(), challengeAndVerify: (a: unknown) => challengeAndVerify(a) },
    },
  })),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: (...a: unknown[]) => adminRpc(...a) }) }));

const INPUT = { action: "support_payment_connection" as const, subjectId: "gym-1", code: "123 456" };

describe("issueSupportStepUp", () => {
  beforeEach(() => {
    challengeAndVerify.mockReset();
    listFactors.mockReset();
    adminRpc.mockReset();
    listFactors.mockResolvedValue({ data: { totp: [{ id: "f1" }] }, error: null });
  });

  it("verifies the code on the caller's own session, then records the grant for that user, action and gym", async () => {
    challengeAndVerify.mockResolvedValue({ error: null });
    adminRpc.mockResolvedValue({ data: "2026-10-21T12:00:00Z", error: null });
    const { issueSupportStepUp } = await import("./support-stepup");

    expect(await issueSupportStepUp(INPUT)).toBe("issued");
    expect(challengeAndVerify).toHaveBeenCalledWith({ factorId: "f1", code: "123456" });
    expect(adminRpc).toHaveBeenCalledWith("stepup_issue", { p_user: "support-1", p_action: "support_payment_connection", p_subject: "gym-1" });
  });

  it("a malformed code never reaches the provider or the database", async () => {
    const { issueSupportStepUp } = await import("./support-stepup");

    expect(await issueSupportStepUp({ ...INPUT, code: "12ab56" })).toBe("invalid_code");
    expect(challengeAndVerify).not.toHaveBeenCalled();
    expect(adminRpc).not.toHaveBeenCalled();
  });

  it("a rejected code issues nothing", async () => {
    challengeAndVerify.mockResolvedValue({ error: { code: "mfa_verification_failed" } });
    const { issueSupportStepUp } = await import("./support-stepup");

    expect(await issueSupportStepUp(INPUT)).toBe("invalid_code");
    expect(adminRpc).not.toHaveBeenCalled();
  });

  it("a provider failure is 'unavailable', not a wrong code", async () => {
    challengeAndVerify.mockResolvedValue({ error: { code: "unexpected_failure" } });
    const { issueSupportStepUp } = await import("./support-stepup");

    expect(await issueSupportStepUp(INPUT)).toBe("unavailable");
  });

  it("no enrolled authenticator cannot pass", async () => {
    listFactors.mockResolvedValue({ data: { totp: [] }, error: null });
    const { issueSupportStepUp } = await import("./support-stepup");

    expect(await issueSupportStepUp(INPUT)).toBe("invalid_code");
    expect(adminRpc).not.toHaveBeenCalled();
  });

  it("the database refusing the grant (not an activated support account) is 'unavailable'", async () => {
    challengeAndVerify.mockResolvedValue({ error: null });
    adminRpc.mockResolvedValue({ data: null, error: { message: "permission_denied" } });
    const { issueSupportStepUp } = await import("./support-stepup");

    expect(await issueSupportStepUp(INPUT)).toBe("unavailable");
  });
});
