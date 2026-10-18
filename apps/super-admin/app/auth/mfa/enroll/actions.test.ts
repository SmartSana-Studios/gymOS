/** Story 22.8: first authenticator after a recovery reset (aal1 session). */
import { beforeEach, describe, expect, it, vi } from "vitest";

const rpcCalls: { fn: string; params: Record<string, unknown> }[] = [];
let allowed = true;
let verifyError: { code: string } | null = null;
const enroll = vi.fn(async () => ({ data: { id: "f1", totp: { qr_code: "qr", secret: "SEC" } }, error: null }));
const unenroll = vi.fn(async () => ({ error: null }));
const challengeAndVerify = vi.fn(async () => ({ error: verifyError }));
const insert = vi.fn(async () => ({ error: null }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: "sa-1" } }, error: null }),
      mfa: { listFactors: async () => ({ data: { all: [{ id: "old", factor_type: "totp", status: "unverified" }] } }), enroll, unenroll, challengeAndVerify },
    },
  })),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({
    rpc: vi.fn(async (fn: string, params: Record<string, unknown>) => {
      rpcCalls.push({ fn, params });
      return { data: fn === "recovery_enrol_allowed" ? allowed : null, error: null };
    }),
    from: () => ({ insert }),
  })),
}));
vi.mock("@/lib/i18n/get-request-locale", () => ({ getRequestLocale: vi.fn(async () => "en") }));
vi.mock("@/lib/i18n/get-server-translation", () => ({ getServerTranslation: vi.fn(async () => ({ t: (k: string) => k })) }));

import { enrollFirstFactor, verifyFirstFactor } from "./actions";

beforeEach(() => {
  rpcCalls.length = 0;
  allowed = true;
  verifyError = null;
  [enroll, unenroll, challengeAndVerify, insert].forEach((m) => m.mockClear());
});

describe("first authenticator after recovery", () => {
  it("is refused unless the database opens the window, and never calls the provider", async () => {
    allowed = false;
    expect((await enrollFirstFactor()).error?.code).toBe("permission_denied");
    expect((await verifyFirstFactor({ factorId: "f1", code: "123456" })).error?.code).toBe("permission_denied");
    expect(enroll).not.toHaveBeenCalled();
    expect(challengeAndVerify).not.toHaveBeenCalled();
  });
  it("clears an abandoned attempt, enrols and audits", async () => {
    const res = await enrollFirstFactor();
    expect(res.data).toEqual({ factorId: "f1", qrCode: "qr", secret: "SEC" });
    expect(unenroll).toHaveBeenCalledWith({ factorId: "old" });
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ action_type: "super_admin_mfa_enrolled", target_entity_id: "f1" }));
  });
  it("a rejected code counts toward the lockout; a provider error does not", async () => {
    verifyError = { code: "mfa_verification_failed" };
    expect((await verifyFirstFactor({ factorId: "f1", code: "123456" })).error?.code).toBe("invalid_code");
    expect(rpcCalls.some((c) => c.fn === "stepup_record_failure")).toBe(true);
    rpcCalls.length = 0;
    verifyError = { code: "unexpected_failure" };
    expect((await verifyFirstFactor({ factorId: "f1", code: "123456" })).error?.code).toBe("verify_failed");
    expect(rpcCalls.some((c) => c.fn === "stepup_record_failure")).toBe(false);
  });
  it("accepts the right code", async () => {
    expect((await verifyFirstFactor({ factorId: "f1", code: "123 456" })).data).toEqual({ verified: true });
  });
});
