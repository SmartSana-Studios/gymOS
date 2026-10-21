"use server";

import type { AppError } from "@gymos/types";
import { authorizePlatformAction, type StepUpAction } from "@/lib/authz";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getServerTranslation } from "@/lib/i18n/get-server-translation";
import { normalizeStepUpSubject } from "@/lib/step-up-subject";

/**
 * Story 22.7: issue a single-use step-up grant. The fresh TOTP is verified HERE, server side, on the
 * session client; only then does the service-role RPC record a grant keyed to the user and bound to
 * (action, subject), valid 5 minutes. Wrong codes are counted (never stored or logged); at the
 * threshold the database locks the account and removes its sessions. `amr` is never read.
 */
export async function issueStepUp(input: {
  action: StepUpAction;
  subjectId: string;
  code: string;
}): Promise<{ data: { issued: true } | null; error: (AppError & { locked?: boolean }) | null }> {
  const { t } = await getServerTranslation(await getRequestLocale());
  const fail = (code: string, key: string, locked = false) => ({
    data: null,
    error: { code, message: t(key), locked },
  });

  const authz = await authorizePlatformAction("platform.super_admin_manage");
  if (!authz.ok) return { data: null, error: authz.error };

  const code = (input.code ?? "").replace(/\s+/g, "");
  if (
    !/^\d{6}$/.test(code) ||
    !input.subjectId ||
    !["remove_super_admin_factor", "create_super_admin", "change_recovery_email", "remove_recovery_email", "start_support_factor_reset"].includes(input.action)
  ) {
    return fail("invalid_code", "stepUp.invalidCode");
  }

  const subject = normalizeStepUpSubject(input.subjectId);
  const supabase = await createClient();
  const { data: list, error: listError } = await supabase.auth.mfa.listFactors();
  const factors = list?.totp ?? []; // verified factors only
  if (listError || factors.length === 0) return fail("invalid_code", "stepUp.invalidCode");

  let verified = false;
  let wrongCode = false;
  for (const f of factors) {
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: f.id, code });
    if (!error) {
      verified = true;
      break;
    }
    // Only a rejected code counts toward the lockout; provider or network errors never do.
    if (error.code === "mfa_verification_failed" || error.code === "mfa_verification_rejected") {
      wrongCode = true;
    }
  }

  const admin = createAdminClient();
  if (!verified && !wrongCode) return fail("unavailable", "stepUp.unavailable");
  if (!verified) {
    const { data, error } = await admin.rpc("stepup_record_failure", { p_user: authz.actorId });
    if (error) return fail("permission_denied", "errors.permissionDenied");
    const row = Array.isArray(data) ? data[0] : null;
    if (row?.locked === true) {
      try {
        await supabase.auth.signOut({ scope: "local" });
      } catch {
        // the database has already removed the sessions
      }
      return fail("account_locked", "stepUp.locked", true);
    }
    return fail("invalid_code", "stepUp.invalidCode");
  }

  const { data: expires, error: issueError } = await admin.rpc("stepup_issue", {
    p_user: authz.actorId,
    p_action: input.action,
    p_subject: subject,
  });
  if (issueError || !expires) return fail("permission_denied", "errors.permissionDenied");
  return { data: { issued: true }, error: null };
}
