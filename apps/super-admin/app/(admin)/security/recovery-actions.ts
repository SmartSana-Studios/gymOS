"use server";

import type { AppError } from "@gymos/types";
import { authorizePlatformAction, consumeStepUp, STEP_UP_REQUIRED_CODE } from "@/lib/authz";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { sendMail } from "@/lib/mail";
import { generateRecoveryCode } from "@/lib/recovery";
import { recoveryEmailChangedMail, recoveryEmailRemovedMail, registerCodeMail, type MailLocale } from "@/lib/recovery-mail";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getServerTranslation } from "@/lib/i18n/get-server-translation";

/**
 * Story 22.8: manage the Super Admin's recovery email from /security (an aal2 session). The code is
 * generated here, handed once to the database (which stores only a hash) and mailed to the NEW address;
 * the address is saved only after the code comes back. Changing or removing an existing address needs a
 * fresh single-use step-up (22.7). Responses carry only a masked address.
 */

export interface RecoveryStatus {
  hasEmail: boolean;
  masked: string | null;
  pendingApplyAt: string | null;
}

type Result<T> = Promise<{ data: T | null; error: AppError | null }>;

const SUBJECT = "recovery"; // step-up subject; lower-case because issueStepUp lower-cases it

async function fail(code: string, key: string): Promise<{ data: null; error: AppError }> {
  const { t } = await getServerTranslation(await getRequestLocale());
  return { data: null, error: { code, message: t(key) } };
}

async function guard() {
  return authorizePlatformAction("platform.super_admin_manage");
}

/** Best effort: tell the login mailbox about a change to the recovery address. A failed send never
 * undoes the change (the audit row is the record); the owner sees the address in /security anyway. */
async function noticeToLoginMailbox(build: (locale: MailLocale) => ReturnType<typeof recoveryEmailRemovedMail>) {
  try {
    const { data } = await (await createClient()).auth.getUser();
    const to = data?.user?.email;
    if (!to) return;
    await sendMail({ to, ...build((await getRequestLocale()) as MailLocale) });
  } catch {
    // never break the action over a notice
  }
}

export async function getRecoveryStatus(): Result<RecoveryStatus> {
  const g = await guard();
  if (!g.ok) return { data: null, error: g.error };
  const { data, error } = await createAdminClient().rpc("recovery_status", { p_user: g.actorId });
  const row = Array.isArray(data) ? data[0] : null;
  if (error || !row) return fail("recovery_failed", "security.recovery.errors.generic");
  return {
    data: { hasEmail: row.has_email === true, masked: row.masked ?? null, pendingApplyAt: row.pending_apply_at ?? null },
    error: null,
  };
}

export async function requestRecoveryEmailCode(input: { email: string }): Result<{ sent: true }> {
  const g = await guard();
  if (!g.ok) return { data: null, error: g.error };
  const admin = createAdminClient();

  // Fail closed: if the status cannot be read we must not assume "no address yet" and skip the step-up.
  const { data: status, error: statusError } = await admin.rpc("recovery_status", { p_user: g.actorId });
  const statusRow = Array.isArray(status) ? status[0] : null;
  if (statusError || !statusRow) return fail("recovery_failed", "security.recovery.errors.generic");
  const hasEmail = statusRow.has_email === true;
  if (hasEmail && !(await consumeStepUp(g.actorId, "change_recovery_email", SUBJECT))) {
    return fail(STEP_UP_REQUIRED_CODE, "stepUp.title");
  }

  const code = generateRecoveryCode();
  const { data, error } = await admin.rpc("recovery_code_issue", {
    p_user: g.actorId,
    p_purpose: "register",
    p_email: input.email ?? "",
    p_code: code,
  });
  const row = Array.isArray(data) ? data[0] : null;
  if (error || !row) return fail("recovery_failed", "security.recovery.errors.generic");
  if (!row.ok) {
    const key =
      row.reason === "same_as_login" ? "sameAsLogin"
      : row.reason === "invalid_email" ? "invalidEmail"
      : row.reason === "rate_limited" ? "rateLimited"
      : "generic";
    return fail(`recovery_${row.reason}`, `security.recovery.errors.${key}`);
  }

  const locale = (await getRequestLocale()) as MailLocale;
  const minutes = 10;
  const sent = await sendMail({ to: row.send_to, ...registerCodeMail(code, minutes, locale) });
  if (!sent.ok) {
    // Void the code that never left and give the attempt back (migration 0131), so a mail outage does not
    // lock the owner out of retrying for an hour.
    const { error: voidError } = await admin.rpc("recovery_code_mail_failed", { p_user: g.actorId, p_purpose: "register" });
    if (voidError) console.error("[recovery] could not record the failed send", voidError.code);
    return fail("mail_failed", sent.reason === "not_configured" ? "security.recovery.errors.notConfigured" : "security.recovery.errors.mailFailed");
  }
  return { data: { sent: true }, error: null };
}

export async function verifyRecoveryEmail(input: { code: string }): Result<{ masked: string }> {
  const g = await guard();
  if (!g.ok) return { data: null, error: g.error };
  const code = (input.code ?? "").replace(/\s+/g, "");
  if (!/^\d{6}$/.test(code)) return fail("invalid_code", "security.recovery.errors.invalidCode");

  const { data, error } = await createAdminClient().rpc("recovery_register_verify", { p_user: g.actorId, p_code: code });
  const row = Array.isArray(data) ? data[0] : null;
  if (error || !row) return fail("recovery_failed", "security.recovery.errors.generic");
  if (!row.ok) {
    return row.reason === "locked"
      ? fail("account_locked", "stepUp.locked")
      : fail("invalid_code", "security.recovery.errors.invalidCode");
  }
  const masked = String(row.masked);
  await noticeToLoginMailbox((locale) => recoveryEmailChangedMail(masked, locale));
  return { data: { masked }, error: null };
}

export async function removeRecoveryEmail(): Result<{ removed: boolean }> {
  const g = await guard();
  if (!g.ok) return { data: null, error: g.error };
  if (!(await consumeStepUp(g.actorId, "remove_recovery_email", SUBJECT))) {
    return fail(STEP_UP_REQUIRED_CODE, "stepUp.title");
  }
  const { data, error } = await createAdminClient().rpc("recovery_email_remove", { p_user: g.actorId });
  if (error) return fail("recovery_failed", "security.recovery.errors.generic");
  if (data === true) await noticeToLoginMailbox(recoveryEmailRemovedMail);
  return { data: { removed: data === true }, error: null };
}
