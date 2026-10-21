import { timingSafeEqual } from "node:crypto";

import type { MailMessage, MailResult } from "@/lib/mail";

/**
 * Story 23.9: the worker for the major-alert e-mail queue (public.email_outbox).
 *
 * The queue and its retry bookkeeping live in the database (claim / finish / record-run functions, service role only). This worker only
 * sends: it reuses the Super Admin app's single mail helper (lib/mail.ts: Resend over SMTP, settings in MAIL_* -- see
 * docs/runbooks/super-admin-recovery.md), so the Resend key is read from this app's environment and nowhere else. A failed send is
 * handed back to the database for a delayed retry (5 attempts, then failed) and shows in job_runs; it never touches the change that
 * queued it. Nothing here logs an address, a subject or a body.
 */

type Rpc = (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
export interface OutboxClient {
  rpc: Rpc;
}

interface ClaimedRow {
  id: string;
  recipient_email: string;
  subject: string;
  body: string;
}

export interface DrainResult {
  claimed: number;
  sent: number;
  failed: number;
  /** Rows sent, or failed, whose result the database could not record (they are re-claimed after 10 minutes). */
  unrecorded?: number;
  error?: "claim_failed";
}

export async function drainEmailOutbox(
  client: OutboxClient,
  send: (message: MailMessage) => Promise<MailResult>,
  limit = 20,
  /** Stop starting new sends after this many milliseconds (the rest stay claimed and are re-claimed later). */
  budgetMs = 45_000,
): Promise<DrainResult> {
  const deadline = Date.now() + budgetMs;
  const started = new Date().toISOString();
  const claim = await client.rpc("claim_email_outbox", { p_limit: limit });
  if (claim.error) return { claimed: 0, sent: 0, failed: 0, error: "claim_failed" };
  const rows = (claim.data ?? []) as ClaimedRow[];

  let sent = 0;
  let failed = 0;
  let unrecorded = 0;
  for (const row of rows) {
    if (Date.now() > deadline) break;
    let result: MailResult;
    try {
      result = await send({ to: row.recipient_email, subject: row.subject, text: row.body });
    } catch {
      result = { ok: false, reason: "send_failed" };
    }
    let recorded = false;
    try {
      const finish = await client.rpc("finish_email_outbox", { p_id: row.id, p_sent: result.ok, p_error: result.ok ? null : result.reason });
      recorded = !finish.error;
    } catch {
      recorded = false;
    }
    if (result.ok) sent += 1;
    else failed += 1;
    if (!recorded) {
      // A row left 'sending' is claimed again after 10 minutes, which can re-send an alert that did go out. Code only, no address or body.
      unrecorded += 1;
      failed += result.ok ? 1 : 0;
      console.error("[email-outbox] finish_email_outbox failed");
    }
  }

  if (rows.length > 0) {
    try {
      const run = await client.rpc("record_email_outbox_run", { p_sent: sent, p_failed: failed, p_started_at: started });
      if (run.error) console.error("[email-outbox] record_email_outbox_run failed");
    } catch {
      console.error("[email-outbox] record_email_outbox_run failed");
    }
  }
  return { claimed: rows.length, sent, failed, ...(unrecorded > 0 ? { unrecorded } : {}) };
}

/** Constant-time `Authorization: Bearer <secret>` check. Fails closed when no secret is configured. */
export function bearerMatches(header: string | null, secret: string | undefined): boolean {
  if (!secret || !header?.startsWith("Bearer ")) return false;
  const given = Buffer.from(header.slice("Bearer ".length));
  const wanted = Buffer.from(secret);
  return given.length === wanted.length && timingSafeEqual(given, wanted);
}
