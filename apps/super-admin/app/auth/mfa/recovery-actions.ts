"use server";

import type { AppError } from "@gymos/types";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendMail } from "@/lib/mail";
import { notifyRecoveryCancelled } from "@/lib/recovery-notify";
import { appBaseUrl, cancelUrl, generateCancelToken, generateRecoveryCode } from "@/lib/recovery";
import { recoveryCodeMail, recoveryScheduledMail, type MailLocale } from "@/lib/recovery-mail";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getServerTranslation } from "@/lib/i18n/get-server-translation";

/**
 * Story 22.8: account recovery from the sign-in prompt. The caller holds only a PASSWORD session (aal1),
 * so the actor is the verified session user and nothing else is trusted. A valid code never grants a
 * session: it schedules the same reset as the operator script, applied after recovery_delay_minutes,
 * with a cancel link to both mailboxes. requestRecoveryCode answers identically for every outcome
 * (unknown role, no recovery email, rate limit, locked, mail failure) so it reveals nothing.
 */

type Result<T> = Promise<{ data: T | null; error: (AppError & { locked?: boolean }) | null }>;

async function sessionUserId(): Promise<string | null> {
  const { data, error } = await (await createClient()).auth.getUser();
  return error ? null : (data?.user?.id ?? null);
}

async function fail(code: string, key: string, locked = false) {
  const { t } = await getServerTranslation(await getRequestLocale());
  return { data: null, error: { code, message: t(key), locked } };
}

export async function requestRecoveryCode(): Result<{ requested: true }> {
  const userId = await sessionUserId();
  if (!userId) return fail("no_session", "mfaPrompt.recovery.failed");

  const code = generateRecoveryCode();
  const { data } = await createAdminClient().rpc("recovery_code_issue", {
    p_user: userId,
    p_purpose: "recover",
    p_email: null,
    p_code: code,
  });
  const row = Array.isArray(data) ? data[0] : null;
  if (row?.ok === true && typeof row.send_to === "string") {
    const locale = (await getRequestLocale()) as MailLocale;
    await sendMail({ to: row.send_to, ...recoveryCodeMail(code, 10, locale) });
  }
  return { data: { requested: true }, error: null };
}

export async function submitRecoveryCode(input: { code: string }): Result<{ applyAt: string }> {
  const userId = await sessionUserId();
  if (!userId) return fail("no_session", "mfaPrompt.recovery.failed");
  const code = (input.code ?? "").replace(/\s+/g, "");
  if (!/^\d{6}$/.test(code)) return fail("invalid_code", "mfaPrompt.recovery.invalid");

  const base = appBaseUrl();
  if (!base) return fail("not_configured", "mfaPrompt.recovery.failed");

  const admin = createAdminClient();
  const token = generateCancelToken();
  const { data, error } = await admin.rpc("recovery_request_verify", { p_user: userId, p_code: code, p_cancel_token: token });
  const row = Array.isArray(data) ? data[0] : null;
  if (error || !row) return fail("recovery_failed", "mfaPrompt.recovery.failed");
  if (!row.ok) {
    if (row.reason === "locked") {
      try {
        await (await createClient()).auth.signOut({ scope: "local" });
      } catch {
        // the database has already removed the sessions
      }
      return fail("account_locked", "mfaPrompt.recovery.locked", true);
    }
    return fail("invalid_code", "mfaPrompt.recovery.invalid");
  }

  // The reset is scheduled. Both mailboxes must be told; if the login mailbox cannot be reached the
  // account owner would not see it, so undo the schedule rather than leave a silent reset pending.
  const locale = (await getRequestLocale()) as MailLocale;
  const mail = recoveryScheduledMail(String(row.apply_at), cancelUrl(base, token), locale);
  const [toLogin, toRecovery] = await Promise.all([
    sendMail({ to: String(row.login_email), ...mail }),
    sendMail({ to: String(row.recovery_email), ...mail }),
  ]);
  if (!toLogin.ok) {
    await admin.rpc("recovery_cancel", { p_token: token });
    return fail("mail_failed", "mfaPrompt.recovery.failed");
  }
  void toRecovery; // best effort: the recovery mailbox just proved itself by supplying the code
  return { data: { applyAt: String(row.apply_at) }, error: null };
}

/**
 * Called by the sign-in prompt right after the authenticator code is accepted. If the session really is
 * aal2 (checked here, never trusted from the client) and a recovery was pending, the real owner has just
 * proved the authenticator works, so the recovery was not theirs: cancel it and tell both mailboxes.
 * Never blocks sign-in.
 */
export async function cancelPendingRecoveryOnSignIn(): Promise<{ cancelled: boolean }> {
  try {
    const supabase = await createClient();
    const userId = await sessionUserId();
    if (!userId) return { cancelled: false };
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal?.currentLevel !== "aal2") return { cancelled: false };
    const { data } = await createAdminClient().rpc("recovery_cancel_for_user", { p_user: userId });
    const row = Array.isArray(data) ? data[0] : null;
    if (!row || Number(row.cancelled) < 1) return { cancelled: false };
    await notifyRecoveryCancelled(row.login_email, row.recovery_email);
    return { cancelled: true };
  } catch {
    return { cancelled: false };
  }
}

/**
 * Polled by the sign-in prompt after a recovery was accepted. "applied": the reset has run (it removes this
 * session, so no session left also means applied) and the page should move on; "cancelled": the pending
 * recovery was cancelled; "waiting": still scheduled. Reveals only the caller's own state.
 */
export async function recoveryProgress(): Promise<{ state: "waiting" | "applied" | "cancelled" }> {
  try {
    const userId = await sessionUserId();
    if (!userId) return { state: "applied" };
    const admin = createAdminClient();
    const { data: enrol } = await admin.rpc("recovery_enrol_allowed", { p_user: userId });
    if (enrol === true) return { state: "applied" };
    const { data } = await admin.rpc("recovery_status", { p_user: userId });
    const row = Array.isArray(data) ? data[0] : null;
    return { state: row && row.pending_apply_at == null ? "cancelled" : "waiting" };
  } catch {
    return { state: "waiting" };
  }
}
