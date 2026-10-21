import type { NextRequest } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { sendMail } from "@/lib/mail";
import { bearerMatches } from "@/lib/email-outbox";
import { dashboardBaseUrl } from "@/lib/support-invite";
import { executeDueFactorResets, type ResetExecutorClient } from "@/lib/support-reset";

/**
 * Story 23.11: the factor-reset executor. Vercel Cron calls it daily with `Authorization: Bearer $CRON_SECRET` (the Super Admin
 * page's "run due resets" button runs the same function through an authenticated action). It removes the old factor of every reset whose
 * cooling-off ended, issues the single-use invite and e-mails it. Public in the proxy, so this check is the whole gate: with no
 * CRON_SECRET configured every call is refused. Returns counts only.
 */
export const maxDuration = 60;

async function handle(request: NextRequest) {
  if (!bearerMatches(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const result = await executeDueFactorResets(createAdminClient() as unknown as ResetExecutorClient, sendMail, dashboardBaseUrl());
    return Response.json(result, { status: result.error ? 500 : 200, headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "execute_failed" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}

export const GET = handle;
export const POST = handle;
