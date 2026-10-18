"use server";

import type { AppError } from "@gymos/types";
import type { EnrollDialogData } from "@/components/enroll-dialog";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getServerTranslation } from "@/lib/i18n/get-server-translation";

/**
 * Story 22.8: enrol the FIRST authenticator after a recovery reset applied. The session is only
 * password-level (aal1) and the account has no verified factor, so /security (aal2 layout) is out of
 * reach. The database opens this path only while recovery_enrol_allowed(user) is true: a reset applied
 * within recovery_enrol_window_minutes AND no verified factor yet. It can therefore never add a second
 * factor, and it closes by itself once the first one verifies. Wrong codes count toward the 22-7 lockout.
 */

type Result<T> = Promise<{ data: T | null; error: AppError | null }>;

async function allowedUser(): Promise<string | null> {
  const { data, error } = await (await createClient()).auth.getUser();
  const id = error ? null : (data?.user?.id ?? null);
  if (!id) return null;
  const { data: allowed, error: rpcError } = await createAdminClient().rpc("recovery_enrol_allowed", { p_user: id });
  return !rpcError && allowed === true ? id : null;
}

async function fail(code: string, key: string): Promise<{ data: null; error: AppError }> {
  const { t } = await getServerTranslation(await getRequestLocale());
  return { data: null, error: { code, message: t(key) } };
}

async function audit(userId: string, action: string, factorId: string): Promise<boolean> {
  const { error } = await createAdminClient().from("audit_log").insert({
    gym_id: null,
    actor_id: userId,
    actor_display_name: "recovery_enrolment",
    action_type: action,
    target_entity_type: "auth.mfa_factors",
    target_entity_id: factorId,
    metadata: {},
  });
  if (error) console.error(`[recovery-enrol] audit write failed for ${action}`, error.code);
  return !error;
}

export async function enrollFirstFactor(): Result<EnrollDialogData> {
  const userId = await allowedUser();
  if (!userId) return fail("permission_denied", "errors.permissionDenied");
  const supabase = await createClient();

  // an abandoned attempt must not pile up
  const { data: list } = await supabase.auth.mfa.listFactors();
  const stale = ((list as { all?: { id: string; factor_type?: string; status?: string }[] } | null)?.all ?? []).filter(
    (f) => f.factor_type === "totp" && f.status === "unverified",
  );
  for (const f of stale) {
    const { error } = await supabase.auth.mfa.unenroll({ factorId: f.id });
    if (error) return fail("enroll_failed", "security.errors.enrollFailed");
  }

  const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: "Authenticator 1" });
  if (error || !data) return fail("enroll_failed", "security.errors.enrollFailed");
  if (!(await audit(userId, "super_admin_mfa_enrolled", data.id))) {
    await supabase.auth.mfa.unenroll({ factorId: data.id });
    return fail("audit_failed", "security.errors.generic");
  }
  return { data: { factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret }, error: null };
}

export async function verifyFirstFactor(input: { factorId: string; code: string }): Result<{ verified: true }> {
  const userId = await allowedUser();
  if (!userId) return fail("permission_denied", "errors.permissionDenied");
  const code = (input.code ?? "").replace(/\s+/g, "");
  if (!/^\d{6}$/.test(code) || !input.factorId) return fail("invalid_code", "security.errors.invalidCode");

  const supabase = await createClient();
  // The factor must be this user's own unverified one (the provider also checks ownership).
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: input.factorId, code });
  if (error) {
    if (error.code === "mfa_verification_failed" || error.code === "mfa_verification_rejected") {
      await createAdminClient().rpc("stepup_record_failure", { p_user: userId });
      return fail("invalid_code", "security.errors.invalidCode");
    }
    return fail("verify_failed", "security.errors.generic");
  }
  return { data: { verified: true }, error: null };
}
