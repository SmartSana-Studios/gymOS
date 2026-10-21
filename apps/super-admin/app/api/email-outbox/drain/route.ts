import type { NextRequest } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { sendMail } from "@/lib/mail";
import { bearerMatches, drainEmailOutbox } from "@/lib/email-outbox";

/**
 * Story 23.9: sends the queued major-alert e-mails (payment-connection changes). Authenticated by `Authorization: Bearer $CRON_SECRET`
 * (Vercel Cron sends it on the daily run; the dashboard sends the same value after a support change to deliver at once). The sender is
 * lib/mail.ts, so the Resend key stays in this app's environment. Public in the proxy, so this check is the whole gate: with no
 * CRON_SECRET configured every call is refused. Returns counts only.
 */
export const maxDuration = 60;

async function handle(request: NextRequest) {
  if (!bearerMatches(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const result = await drainEmailOutbox(createAdminClient(), sendMail);
    return Response.json(result, { status: result.error ? 500 : 200, headers: { "Cache-Control": "no-store" } });
  } catch {
    // Code only: the cause may carry an address or a key.
    return Response.json({ error: "drain_failed" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}

export const GET = handle;
export const POST = handle;
