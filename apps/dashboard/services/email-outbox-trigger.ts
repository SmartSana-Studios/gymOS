/**
 * Story 23.9: asks the Super Admin app to send queued major-alert e-mails now.
 *
 * The mail sender (Resend, through apps/super-admin/lib/mail.ts) and its key live ONLY in the Super Admin app; the dashboard never
 * reads them. This is a best-effort nudge: the queue lives in the database and the Super Admin app's own daily cron drains it too, so
 * a missing setting or a failed call only delays the e-mail. Needs SUPER_ADMIN_APP_URL and EMAIL_DRAIN_SECRET (the same value as the
 * Super Admin app's CRON_SECRET). Never throws; logs nothing about the address or the body.
 */
export async function nudgeEmailOutbox(env: Record<string, string | undefined> = process.env): Promise<boolean> {
  const base = env.SUPER_ADMIN_APP_URL?.trim().replace(/\/+$/, "");
  const secret = env.EMAIL_DRAIN_SECRET;
  if (!base || !secret) return false;
  try {
    const response = await fetch(`${base}/api/email-outbox/drain`, {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(4000),
      cache: "no-store",
    });
    return response.ok;
  } catch {
    return false;
  }
}
