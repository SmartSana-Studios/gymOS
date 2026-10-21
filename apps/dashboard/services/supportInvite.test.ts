import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));

import type { SupabaseClient } from "@supabase/supabase-js";
import { beginTotpEnrollment, inspectInvite, setInvitePassword, verifyTotpAndActivate, type InviteDeps } from "./supportInvite";

const TOKEN = "00000000-0000-4000-8000-000000000001." + "a".repeat(64);
const PASSWORD = "correct horse battery staple";
const UID = "00000000-0000-4000-8000-0000000000aa";
const FACTOR = "00000000-0000-4000-8000-0000000000f1";

function makeDeps(opts: { inspect?: unknown; rpc?: Record<string, unknown>; verifyError?: boolean; transientError?: boolean; updateError?: unknown; signInError?: boolean } = {}) {
  const rpcCalls: [string, unknown][] = [];
  const rpcResults: Record<string, unknown> = {
    support_invite_inspect: opts.inspect === undefined ? [{ ok: true, step: "password", user_id: UID, email: "sup@gymosapps.com" }] : opts.inspect,
    support_invite_mark_password_set: true,
    support_invite_code_failed: true,
    activate_support_account: [{ ok: true, reason: "ok" }],
    ...opts.rpc,
  };
  const updateUserById = vi.fn(async () => ({ error: (opts.updateError ?? null) as unknown }));
  const deleteFactor = vi.fn(async () => ({ error: null }));
  const signIn = vi.fn(async (creds: { email: string; password: string }) => (
    opts.signInError || creds.password !== PASSWORD
      ? { data: { session: null }, error: { message: "Invalid login credentials" } }
      : { data: { session: {} }, error: null }
  ));
  const signOut = vi.fn(async () => ({ error: null }));
  const enroll = vi.fn(async () => ({ data: { id: FACTOR, totp: { qr_code: "data:image/svg+xml;utf8,<svg/>", secret: "SECRET" } }, error: null }));
  const challengeAndVerify = vi.fn(async () => ({ data: {}, error: opts.verifyError ? { code: opts.transientError ? "unexpected_failure" : "mfa_verification_failed", message: "bad" } : null }));
  const admin = {
    rpc: vi.fn(async (name: string, args: unknown) => {
      rpcCalls.push([name, args]);
      return { data: rpcResults[name], error: null };
    }),
    auth: {
      admin: {
        updateUserById,
        mfa: { listFactors: vi.fn(async () => ({ data: { factors: [{ id: "old" }] } })), deleteFactor },
      },
    },
  } as unknown as SupabaseClient;
  const deps: InviteDeps = {
    admin,
    anon: () =>
      ({ auth: { signInWithPassword: signIn, signOut, mfa: { enroll, challengeAndVerify } } }) as unknown as SupabaseClient,
  };
  return { deps, rpcCalls, updateUserById, deleteFactor, signOut, signIn, enroll, challengeAndVerify };
}

describe("inspectInvite", () => {
  it("reports the step for a valid link", async () => {
    expect(await inspectInvite(TOKEN, makeDeps().deps)).toEqual({ ok: true, step: "password" });
  });
  it("answers every bad link identically, without calling the database for a malformed token", async () => {
    const a = makeDeps({ inspect: [{ ok: false }] });
    const b = makeDeps();
    expect(await inspectInvite(TOKEN, a.deps)).toEqual({ ok: false });
    expect(await inspectInvite("nope", b.deps)).toEqual({ ok: false });
    expect(await inspectInvite(undefined, b.deps)).toEqual({ ok: false });
    expect(b.rpcCalls).toEqual([]);
  });
});

describe("setInvitePassword", () => {
  it("sets the password of the invite's account and records the step", async () => {
    const m = makeDeps();
    expect(await setInvitePassword(TOKEN, "correct horse battery", m.deps)).toEqual({ ok: true });
    expect(m.updateUserById).toHaveBeenCalledWith(UID, { password: "correct horse battery" });
    expect(m.rpcCalls.map(([n]) => n)).toContain("support_invite_mark_password_set");
  });
  it("refuses a short password without touching the account", async () => {
    const m = makeDeps();
    expect(await setInvitePassword(TOKEN, "short", m.deps)).toEqual({ ok: false, weak: true });
    expect(m.updateUserById).not.toHaveBeenCalled();
  });
  it("keeps the form open when the auth server rejects the password", async () => {
    const m = makeDeps({ updateError: { code: "weak_password", status: 422 } });
    expect(await setInvitePassword(TOKEN, "correct horse battery", m.deps)).toEqual({ ok: false, weak: true });
    expect(m.rpcCalls.map(([n]) => n)).not.toContain("support_invite_mark_password_set");
    const other = makeDeps({ updateError: { code: "unexpected_failure", status: 500 } });
    expect(await setInvitePassword(TOKEN, "correct horse battery", other.deps)).toEqual({ ok: false });
  });
  it("refuses when the invite is already past the password step", async () => {
    const m = makeDeps({ inspect: [{ ok: true, step: "totp", user_id: UID, email: "sup@gymosapps.com" }] });
    expect(await setInvitePassword(TOKEN, "correct horse battery", m.deps)).toEqual({ ok: false });
    expect(m.updateUserById).not.toHaveBeenCalled();
  });
});

describe("TOTP enrolment bound to the invite", () => {
  const totpInspect = [{ ok: true, step: "totp", user_id: UID, email: "sup@gymosapps.com" }];

  it("does not enrol before the password step or on a bad link", async () => {
    const early = makeDeps();
    expect(await beginTotpEnrollment(TOKEN, PASSWORD, early.deps)).toEqual({ ok: false });
    expect(early.enroll).not.toHaveBeenCalled();
    const bad = makeDeps({ inspect: [{ ok: false }] });
    expect(await beginTotpEnrollment(TOKEN, PASSWORD, bad.deps)).toEqual({ ok: false });
    expect(bad.enroll).not.toHaveBeenCalled();
  });

  it("replaces an abandoned factor, enrols, and ends the temporary session", async () => {
    const m = makeDeps({ inspect: totpInspect });
    expect(await beginTotpEnrollment(TOKEN, PASSWORD, m.deps)).toEqual({ ok: true, factorId: FACTOR, qrCode: expect.any(String), secret: "SECRET" });
    expect(m.deleteFactor).toHaveBeenCalledWith({ id: "old", userId: UID });
    expect(m.signOut).toHaveBeenCalled();
  });

  it("signs in with the password just set, never through an admin-issued link", async () => {
    const m = makeDeps({ inspect: totpInspect });
    await beginTotpEnrollment(TOKEN, PASSWORD, m.deps);
    expect(m.signIn).toHaveBeenCalledWith({ email: "sup@gymosapps.com", password: PASSWORD });
  });

  it("a wrong or missing password mints no session and enrols nothing", async () => {
    const m = makeDeps({ inspect: totpInspect });
    expect(await beginTotpEnrollment(TOKEN, "wrong", m.deps)).toEqual({ ok: false });
    expect(await beginTotpEnrollment(TOKEN, undefined, m.deps)).toEqual({ ok: false });
    expect(m.enroll).not.toHaveBeenCalled();
    expect(await verifyTotpAndActivate(TOKEN, FACTOR, "123456", "wrong", m.deps)).toEqual({ ok: false, canRetry: true });
    expect(m.challengeAndVerify).not.toHaveBeenCalled();
    expect(m.rpcCalls.map(([n]) => n)).not.toContain("support_invite_code_failed");
    expect(m.rpcCalls.map(([n]) => n)).not.toContain("activate_support_account");
  });

  it("activates only after a verified code", async () => {
    const m = makeDeps({ inspect: totpInspect });
    expect(await verifyTotpAndActivate(TOKEN, FACTOR, "123456", PASSWORD, m.deps)).toEqual({ ok: true });
    expect(m.rpcCalls.map(([n]) => n)).toContain("activate_support_account");
  });

  it("a wrong code counts against the invite and never activates", async () => {
    const m = makeDeps({ inspect: totpInspect, verifyError: true });
    expect(await verifyTotpAndActivate(TOKEN, FACTOR, "123456", PASSWORD, m.deps)).toEqual({ ok: false, canRetry: true });
    expect(m.rpcCalls.map(([n]) => n)).toContain("support_invite_code_failed");
    expect(m.rpcCalls.map(([n]) => n)).not.toContain("activate_support_account");
  });

  it("a transient auth error is retryable and is not counted against the invite", async () => {
    const m = makeDeps({ inspect: totpInspect, verifyError: true, transientError: true });
    expect(await verifyTotpAndActivate(TOKEN, FACTOR, "123456", PASSWORD, m.deps)).toEqual({ ok: false, canRetry: true });
    expect(m.rpcCalls.map(([n]) => n)).not.toContain("support_invite_code_failed");
    expect(m.rpcCalls.map(([n]) => n)).not.toContain("activate_support_account");
  });

  it("stops offering retries once the database says the invite is dead", async () => {
    const m = makeDeps({ inspect: totpInspect, verifyError: true, rpc: { support_invite_code_failed: false } });
    expect(await verifyTotpAndActivate(TOKEN, FACTOR, "123456", PASSWORD, m.deps)).toEqual({ ok: false, canRetry: false });
  });

  it("a database refusal at activation is a plain failure", async () => {
    const m = makeDeps({ inspect: totpInspect, rpc: { activate_support_account: [{ ok: false, reason: "collision" }] } });
    expect(await verifyTotpAndActivate(TOKEN, FACTOR, "123456", PASSWORD, m.deps)).toEqual({ ok: false, canRetry: false });
  });

  it("rejects a malformed code without minting a session", async () => {
    const m = makeDeps({ inspect: totpInspect });
    expect(await verifyTotpAndActivate(TOKEN, FACTOR, "12ab56", PASSWORD, m.deps)).toEqual({ ok: false, canRetry: true });
    expect(m.challengeAndVerify).not.toHaveBeenCalled();
  });
});
