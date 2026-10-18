import { sendMail } from "@/lib/mail";
import { recoveryCancelledMail, type MailLocale } from "@/lib/recovery-mail";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";

/**
 * Story 22.8: tell both mailboxes a scheduled recovery was cancelled (by the link or by the owner signing
 * in). Best effort and never throws: the cancel has already happened and is audited.
 */
export async function notifyRecoveryCancelled(loginEmail: unknown, recoveryEmail: unknown): Promise<void> {
  try {
    const mail = recoveryCancelledMail((await getRequestLocale()) as MailLocale);
    const targets = [...new Set([loginEmail, recoveryEmail].filter((v): v is string => typeof v === "string" && v.length > 0))];
    await Promise.all(targets.map((to) => sendMail({ to, ...mail })));
  } catch {
    // a notice failure must not turn a cancel into an error
  }
}
