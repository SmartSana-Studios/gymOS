"use server";

import type { AppError } from "@gymos/types";
import { authorizePlatformAction, consumeStepUp, requireSuperAdminAal2, STEP_UP_REQUIRED_CODE } from "@/lib/authz";
import { createClient } from "@/lib/supabase/server";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getServerTranslation } from "@/lib/i18n/get-server-translation";

/**
 * Story 22.5: Super Admin second-factor enrollment. Every provider call (mfa.enroll, challenge,
 * verify, unenroll) happens here, on the session client, after a live Super Admin check and the
 * aal gate. The browser never calls mfa.enroll. Audit rows carry actor, action and timestamp
 * (via log_audit_event) and a factor id only: never a secret, QR URI or code.
 */

export interface FactorRow {
  id: string;
  friendlyName: string | null;
  status: "verified" | "unverified";
  createdAt: string;
}

export interface EnrollResult {
  factorId: string;
  qrCode: string;
  secret: string;
}

type Result<T> = Promise<{ data: T | null; error: AppError | null }>;

async function err(code: string, key: string): Promise<AppError> {
  const { t } = await getServerTranslation(await getRequestLocale());
  return { code, message: t(key) };
}

async function guard(): Promise<{ ok: true; actorId: string } | { ok: false; error: AppError }> {
  const authz = await authorizePlatformAction("platform.super_admin_manage");
  if (!authz.ok) return { ok: false, error: authz.error };
  const aal = await requireSuperAdminAal2();
  if (!aal.ok) return { ok: false, error: aal.error };
  return { ok: true, actorId: authz.actorId };
}

async function currentAal(supabase: Awaited<ReturnType<typeof createClient>>): Promise<string | null> {
  const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  return error ? null : (data?.currentLevel ?? null);
}

async function audit(
  supabase: Awaited<ReturnType<typeof createClient>>,
  action: string,
  factorId: string,
): Promise<boolean> {
  const { error } = await supabase.rpc("log_audit_event", {
    p_action_type: action,
    p_target_entity_id: factorId,
    p_target_entity_type: "auth.mfa_factors",
  });
  if (error) {
    console.error(`[security] audit write failed for ${action}`, error.code);
    return false;
  }
  return true;
}

export async function listFactors(): Result<FactorRow[]> {
  const g = await guard();
  if (!g.ok) return { data: null, error: g.error };
  const supabase = await createClient();
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error) return { data: null, error: await err("factor_list_failed", "security.errors.generic") };
  const all = (data as { all?: { id: string; factor_type: string; friendly_name?: string | null; status: string; created_at: string }[] }).all ?? [];
  return {
    data: all
      .filter((f) => f.factor_type === "totp")
      .map((f) => ({
        id: f.id,
        friendlyName: f.friendly_name ?? null,
        status: f.status === "verified" ? "verified" : "unverified",
        createdAt: f.created_at,
      })),
    error: null,
  };
}

type RawFactor = { id: string; factor_type?: string; status?: string; friendly_name?: string | null };

export async function enrollFactor(input: { friendlyName?: string }): Result<EnrollResult> {
  const g = await guard();
  if (!g.ok) return { data: null, error: g.error };
  const supabase = await createClient();

  const { data: list, error: listError } = await supabase.auth.mfa.listFactors();
  if (listError) return { data: null, error: await err("factor_list_failed", "security.errors.generic") };
  const verifiedCount = (list?.totp ?? []).length; // listFactors().totp holds verified factors only

  // A second factor needs aal2, decided here before the provider is called.
  if (verifiedCount > 0 && (await currentAal(supabase)) !== "aal2") {
    // Epic 22 retro item 73: say what to do, not "you do not have permission". The page links to /auth/mfa.
    return { data: null, error: await err("aal2_required", "security.errors.verifyFirst") };
  }

  // Clear abandoned unverified factors so retries do not pile up toward the cap.
  const stale = ((list as { all?: RawFactor[] } | null)?.all ?? []).filter(
    (f) => f.factor_type === "totp" && f.status === "unverified",
  );
  for (const f of stale) {
    const { error: cleanupError } = await supabase.auth.mfa.unenroll({ factorId: f.id });
    if (cleanupError) return { data: null, error: await err("enroll_failed", "security.errors.enrollFailed") };
    await audit(supabase, "super_admin_mfa_removed", f.id);
  }

  // The provider refuses two factors with the same friendly name (an empty name counts), which blocked
  // adding the second device. Default to the first unused "Authenticator N".
  const taken = new Set(
    ((list as { all?: RawFactor[] } | null)?.all ?? [])
      .filter((f) => f.status !== "unverified")
      .map((f) => f.friendly_name ?? ""),
  );
  let n = 1;
  while (taken.has(`Authenticator ${n}`)) n += 1;
  const name = (input.friendlyName ?? "").trim().slice(0, 64) || `Authenticator ${n}`;
  const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: name });
  if (error || !data) return { data: null, error: await err("enroll_failed", "security.errors.enrollFailed") };

  if (!(await audit(supabase, "super_admin_mfa_enrolled", data.id))) {
    // Never leave an unaudited factor behind.
    const { error: rollbackError } = await supabase.auth.mfa.unenroll({ factorId: data.id });
    if (rollbackError) console.error("[security] rollback unenroll failed", rollbackError.code);
    return { data: null, error: await err("audit_failed", "security.errors.generic") };
  }
  return { data: { factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret }, error: null };
}

export async function verifyFactor(input: { factorId: string; code: string }): Result<{ verified: true }> {
  const g = await guard();
  if (!g.ok) return { data: null, error: g.error };
  const code = (input.code ?? "").replace(/\s+/g, "");
  if (!/^\d{6}$/.test(code) || !input.factorId) {
    return { data: null, error: await err("invalid_code", "security.errors.invalidCode") };
  }
  const supabase = await createClient();
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: input.factorId, code });
  if (error) {
    // The factor stays unverified; no audit of success.
    return { data: null, error: await err("invalid_code", "security.errors.invalidCode") };
  }
  if (!(await audit(supabase, "super_admin_mfa_verified", input.factorId))) {
    // The provider action cannot be rolled back: fail loudly instead of reporting success.
    return { data: null, error: await err("audit_failed", "security.errors.generic") };
  }
  return { data: { verified: true }, error: null };
}

async function stillOnlyVerifiedFactor(supabase: Awaited<ReturnType<typeof createClient>>, factorId: string): Promise<boolean> {
  try {
    const { data } = await supabase.auth.mfa.listFactors();
    const verified = data?.totp ?? [];
    return verified.length === 1 && verified[0].id === factorId;
  } catch {
    return false;
  }
}

export async function removeFactor(input: { factorId: string }): Result<{ removed: true; signedOut: boolean; signOutFailed: boolean; auditFailed: boolean }> {
  const g = await guard();
  if (!g.ok) return { data: null, error: g.error };
  const supabase = await createClient();

  const { data: list, error: listError } = await supabase.auth.mfa.listFactors();
  if (listError) return { data: null, error: await err("factor_list_failed", "security.errors.generic") };
  const verified = list?.totp ?? [];
  const isVerified = verified.some((f) => f.id === input.factorId);
  const known = ((list as { all?: RawFactor[] } | null)?.all ?? []).find((f) => f.id === input.factorId);
  const isUnverified = !isVerified && known?.status === "unverified";

  // Removing a verified (or unknown) factor needs aal2; an abandoned unverified one does not.
  if (!isUnverified && (await currentAal(supabase)) !== "aal2") {
    return { data: null, error: await err("permission_denied", "errors.permissionDenied") };
  }

  if (!isUnverified) {
    const { data: required, error: flagError } = await (await import("@/lib/supabase/admin"))
      .createAdminClient()
      .rpc("super_admin_aal2_required");
    if (flagError || typeof required !== "boolean") {
      return { data: null, error: await err("permission_denied", "errors.permissionDenied") };
    }
    if (required && isVerified && verified.length <= 1) {
      return { data: null, error: await err("last_factor", "security.errors.lastFactor") };
    }
  }

  // Story 22.7: removing a verified factor needs a fresh single-use step-up bound to this factor.
  if (!isUnverified && !(await consumeStepUp(g.actorId, "remove_super_admin_factor", input.factorId))) {
    return { data: null, error: await err(STEP_UP_REQUIRED_CODE, "stepUp.title") };
  }

  const { error } = await supabase.auth.mfa.unenroll({ factorId: input.factorId });
  if (error) {
    // 0129: the database refuses to delete the last verified factor while the flag is on (a concurrent removal
    // that slipped past the count above). GoTrue hides the trigger's message behind a generic database error
    // (checked against the local auth service), so do not rely on the text: if the factor is still there and
    // it is the only verified one, that is the guard.
    const refused =
      String(error.message ?? "").includes("last_verified_factor") ||
      (isVerified && (await stillOnlyVerifiedFactor(supabase, input.factorId)));
    if (refused) return { data: null, error: await err("last_factor", "security.errors.lastFactor") };
    return { data: null, error: await err("remove_failed", "security.errors.generic") };
  }
  // The factor is already gone. An audit failure must not stop the sessions from being ended (a stale device or
  // session must not outlive its factor), so record it, carry on, and report it (epic 22 retro item 58).
  const auditOk = await audit(supabase, "super_admin_mfa_removed", input.factorId);

  // Story 22.7: removing a verified factor ends every session of this user (a stale device or
  // session must not outlive its factor). Existing admin client, global scope; no new RPC.
  let signedOut = false;
  if (!isUnverified) {
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess?.session?.access_token;
      if (token) {
        const { createAdminClient } = await import("@/lib/supabase/admin");
        const { error: outError } = await createAdminClient().auth.admin.signOut(token, "global");
        signedOut = !outError;
        if (outError) console.error("[security] global sign-out failed", outError.message);
      }
    } catch {
      console.error("[security] global sign-out failed");
    }
  }
  // A verified factor was removed but its sessions could not be ended: the caller must say so.
  return { data: { removed: true, signedOut, signOutFailed: !isUnverified && !signedOut, auditFailed: !auditOk }, error: null };
}
