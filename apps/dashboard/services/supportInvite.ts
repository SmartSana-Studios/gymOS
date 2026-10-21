import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Story 23.4: the support invitee's server functions. The invite link is the only credential; every step re-checks the
 * invite in the database (support_invite_inspect: hashed token, 24 h, single use, attempts limit) before doing anything,
 * and every failure of any kind returns the same `{ ok: false }` (no reason, no hint which check failed).
 *
 * TOTP enrolment runs only here (AD-38): a short-lived aal1 session is minted server-side for the invite's account
 * (never handed to the browser), used to enrol and verify the factor, and ended when the account is activated.
 */

export const SUPPORT_PASSWORD_MIN_LENGTH = 12;

export type InviteStep = "password" | "totp";
export type InspectResult = { ok: true; step: InviteStep } | { ok: false };
export type PasswordResult = { ok: true } | { ok: false; weak?: boolean };
export type EnrollResult = { ok: true; factorId: string; qrCode: string; secret: string } | { ok: false };
export type VerifyResult = { ok: true } | { ok: false; canRetry: boolean };

export interface InviteDeps {
  admin: SupabaseClient;
  /** A throwaway client that never persists a session. */
  anon: () => SupabaseClient;
}

function defaultDeps(): InviteDeps {
  return {
    admin: createAdminClient(),
    anon: () =>
      createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      }),
  };
}

const TOKEN_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[0-9a-f]{64}$/;

interface Inspected {
  step: InviteStep;
  userId: string;
  email: string;
}

async function inspect(deps: InviteDeps, token: unknown): Promise<Inspected | null> {
  if (typeof token !== "string" || !TOKEN_SHAPE.test(token)) return null;
  const { data, error } = await deps.admin.rpc("support_invite_inspect", { p_token: token });
  const row = Array.isArray(data) ? data[0] : null;
  if (error || !row || row.ok !== true || !row.user_id || !row.email) return null;
  return { step: row.step === "totp" ? "totp" : "password", userId: row.user_id, email: row.email };
}

export async function inspectInvite(token: unknown, deps: InviteDeps = defaultDeps()): Promise<InspectResult> {
  try {
    const found = await inspect(deps, token);
    return found ? { ok: true, step: found.step } : { ok: false };
  } catch {
    return { ok: false };
  }
}

export async function setInvitePassword(token: unknown, password: unknown, deps: InviteDeps = defaultDeps()): Promise<PasswordResult> {
  try {
    const found = await inspect(deps, token);
    if (!found || found.step !== "password") return { ok: false };
    if (typeof password !== "string" || password.length < SUPPORT_PASSWORD_MIN_LENGTH || password.length > 128) {
      return { ok: false, weak: true };
    }
    const { error } = await deps.admin.auth.admin.updateUserById(found.userId, { password });
    if (error) return { ok: false };
    const { data: marked, error: markError } = await deps.admin.rpc("support_invite_mark_password_set", { p_token: token });
    if (markError || marked !== true) return { ok: false };
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

/** A session for the invite's account, minted server-side from an admin-issued link. Never returned to the browser. */
async function mintSession(deps: InviteDeps, email: string): Promise<SupabaseClient | null> {
  const { data, error } = await deps.admin.auth.admin.generateLink({ type: "magiclink", email });
  const hashed = data?.properties?.hashed_token;
  if (error || !hashed) return null;
  const client = deps.anon();
  const { data: verified, error: verifyError } = await client.auth.verifyOtp({ token_hash: hashed, type: "magiclink" });
  if (verifyError || !verified?.session) return null;
  return client;
}

async function endSession(client: SupabaseClient | null) {
  try {
    await client?.auth.signOut({ scope: "global" });
  } catch {
    // The session is also ended by activation; this is best effort for abandoned attempts.
  }
}

export async function beginTotpEnrollment(token: unknown, deps: InviteDeps = defaultDeps()): Promise<EnrollResult> {
  let client: SupabaseClient | null = null;
  try {
    const found = await inspect(deps, token);
    if (!found || found.step !== "totp") return { ok: false };

    // The account is not active, so any earlier factor (an abandoned enrolment) can be replaced.
    const { data: factors } = await deps.admin.auth.admin.mfa.listFactors({ userId: found.userId });
    for (const f of factors?.factors ?? []) {
      await deps.admin.auth.admin.mfa.deleteFactor({ id: f.id, userId: found.userId });
    }

    client = await mintSession(deps, found.email);
    if (!client) return { ok: false };
    const { data, error } = await client.auth.mfa.enroll({ factorType: "totp", friendlyName: "GymOS support" });
    if (error || !data?.id || !data.totp) return { ok: false };
    return { ok: true, factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret };
  } catch {
    return { ok: false };
  } finally {
    await endSession(client);
  }
}

export async function verifyTotpAndActivate(
  token: unknown,
  factorId: unknown,
  code: unknown,
  deps: InviteDeps = defaultDeps(),
): Promise<VerifyResult> {
  let client: SupabaseClient | null = null;
  try {
    const found = await inspect(deps, token);
    if (!found || found.step !== "totp") return { ok: false, canRetry: false };
    if (typeof factorId !== "string" || !/^[0-9a-f-]{36}$/i.test(factorId) || typeof code !== "string" || !/^\d{6}$/.test(code)) {
      return { ok: false, canRetry: true };
    }

    client = await mintSession(deps, found.email);
    if (!client) return { ok: false, canRetry: true };
    const { error } = await client.auth.mfa.challengeAndVerify({ factorId, code });
    if (error) {
      // A wrong code counts against the invite; the invite dies at the limit.
      const { data: stillOpen } = await deps.admin.rpc("support_invite_code_failed", { p_token: token });
      return { ok: false, canRetry: stillOpen === true };
    }

    const { data, error: activateError } = await deps.admin.rpc("activate_support_account", { p_token: token });
    const row = Array.isArray(data) ? data[0] : null;
    if (activateError || !row || row.ok !== true) return { ok: false, canRetry: false };
    return { ok: true };
  } catch {
    return { ok: false, canRetry: false };
  } finally {
    await endSession(client);
  }
}
