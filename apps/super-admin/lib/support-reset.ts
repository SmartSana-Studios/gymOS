import { randomBytes } from "node:crypto";

import type { MailMessage, MailResult } from "@/lib/mail";
import { generateSupportInviteToken, supportInviteLink, supportInviteMail } from "@/lib/support-invite";

/**
 * Story 23.11: the support authenticator reset. The cancel token is 64 hex characters made here; only its SHA-256 is stored. The link
 * goes to the dashboard app's public cancel route (configured origin, never the request's Host). The executor removes the old factor
 * through the Admin API (service role: verified 200, docs/decisions.md), issues a single-use invite and reports back to the database.
 */

export function generateResetCancelToken(): string {
  return randomBytes(32).toString("hex");
}

export function supportResetCancelLink(origin: string, token: string): string {
  return `${origin}/support-reset-cancel?t=${encodeURIComponent(token)}`;
}

/** The invite mailed after a reset: the same single-use link as a first invite, with the reset explained. Always EN then FR (the cron has no request locale). */
export function supportResetInviteMail(opts: { link: string }): Omit<MailMessage, "to"> {
  const en = supportInviteMail({ link: opts.link, locale: "en" });
  const fr = supportInviteMail({ link: opts.link, locale: "fr" });
  const enNote = "Your previous authenticator was removed after the reset that was requested. Choose a new password and set up a new authenticator: you have no access before that.";
  const frNote = "Votre authentificateur précédent a été supprimé suite à la réinitialisation demandée. Choisissez un nouveau mot de passe et configurez un nouvel authentificateur : vous n'aurez aucun accès avant.";
  return {
    subject: `${en.subject} / ${fr.subject}`,
    text: `${enNote}\n\n${en.text}\n\n---\n\n${frNote}\n\n${fr.text}`,
  };
}

type Rpc = (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
export interface ResetExecutorClient {
  rpc: Rpc;
  auth: {
    admin: {
      mfa: {
        listFactors: (a: { userId: string }) => PromiseLike<{ data: { factors?: { id: string }[] } | null; error: unknown }>;
        deleteFactor: (a: { id: string; userId: string }) => PromiseLike<{ error: unknown }>;
      };
    };
  };
}

export interface ResetExecutorResult {
  claimed: number;
  done: number;
  failed: number;
  error?: "claim_failed" | "not_configured";
}

interface Claimed {
  reset_id: string;
  user_id: string;
  email: string | null;
}

/**
 * Executes the resets whose cooling-off ended. Per reset: remove every factor (Admin API), issue the invite, mail it, report done. Any
 * failure reports `failed` (the database retries the reset on the next run) and is counted; nothing logs an address or a token. A run
 * always writes its job_runs row, so a silent scheduler shows in the alert.
 */
export async function executeDueFactorResets(
  client: ResetExecutorClient,
  send: (message: MailMessage) => Promise<MailResult>,
  origin: string | null,
  limit = 10,
): Promise<ResetExecutorResult> {
  const started = new Date().toISOString();
  const record = async (done: number, failed: number) => {
    try {
      await client.rpc("record_support_factor_reset_run", { p_done: done, p_failed: failed, p_started_at: started });
    } catch {
      console.error("[support-reset] record_support_factor_reset_run failed");
    }
  };

  if (!origin) {
    await record(0, 1);
    return { claimed: 0, done: 0, failed: 0, error: "not_configured" };
  }
  const claim = await client.rpc("claim_support_factor_resets", { p_limit: limit });
  if (claim.error) {
    await record(0, 1);
    return { claimed: 0, done: 0, failed: 0, error: "claim_failed" };
  }
  const rows = (claim.data ?? []) as Claimed[];

  let done = 0;
  let failed = 0;
  for (const row of rows) {
    const fail = async (code: string) => {
      failed += 1;
      try {
        await client.rpc("support_factor_reset_failed", { p_reset_id: row.reset_id, p_error: code });
      } catch {
        console.error("[support-reset] support_factor_reset_failed failed");
      }
    };
    try {
      if (!row.email) {
        await fail("no_email");
        continue;
      }
      // 1. remove the old factor(s). A factor that is already gone is fine (a retry).
      const listed = await client.auth.admin.mfa.listFactors({ userId: row.user_id });
      if (listed.error) {
        await fail("list_factors_failed");
        continue;
      }
      const factors = listed.data?.factors ?? [];
      let removeFailed = false;
      for (const f of factors) {
        const res = await client.auth.admin.mfa.deleteFactor({ id: f.id, userId: row.user_id });
        if (res.error) removeFailed = true;
      }
      if (removeFailed) {
        await fail("delete_factor_failed");
        continue;
      }
      // 2. the single-use invite (earlier ones are superseded), 3. mail it, 4. report done
      const token = generateSupportInviteToken();
      const issued = await client.rpc("issue_support_reset_invite", { p_reset_id: row.reset_id, p_token: token });
      if (issued.error) {
        await fail("invite_failed");
        continue;
      }
      let sent: MailResult;
      try {
        sent = await send({ to: row.email, ...supportResetInviteMail({ link: supportInviteLink(origin, token) }) });
      } catch {
        sent = { ok: false, reason: "send_failed" };
      }
      if (!sent.ok) {
        await fail("mail_failed");
        continue;
      }
      const marked = await client.rpc("support_factor_reset_done", { p_reset_id: row.reset_id, p_factors_removed: factors.length });
      if (marked.error || marked.data !== true) {
        // the person has the invite but the database did not record it: leave it claimed, it is re-claimed after 10 minutes
        failed += 1;
        continue;
      }
      done += 1;
    } catch {
      await fail("unexpected");
    }
  }
  await record(done, failed);
  return { claimed: rows.length, done, failed };
}

