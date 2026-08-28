/**
 * Story 11.3 (Task 4, AC #1/#2/#3/#4/#5): daily payment-due reminder job.
 * The project's first Vercel Cron job -- every other scheduled job in this
 * codebase runs as `pg_cron` (AD-19), but the WhatsApp/SMS credentials this
 * job needs (`EVOLUTION_API_*`/`TWILIO_*`) only exist as Node env vars, not
 * in Postgres/Vault (Story 11.3's Context section, point 5 -- confirmed
 * with the user at dev-story time before this file was written).
 *
 * Scheduled via `apps/dashboard/vercel.json` (`0 2 * * *` UTC = 03:00
 * Africa/Douala, one hour after `run_saas_billing_lifecycle_job()`'s own
 * 02:00 Africa/Douala slot -- 0071 -- so a gym that flipped to `suspended`
 * overnight is already excluded from today's reminder by the time this
 * runs, rather than racing it).
 *
 * Authenticated via `CRON_SECRET` (`Authorization: Bearer $CRON_SECRET`,
 * sent automatically by Vercel when that env var is set on the project --
 * verified against Vercel's current docs at implementation time, not
 * assumed). This is the project's first API route reachable from outside
 * its own app/Supabase, so the auth guard is the first thing this handler
 * does.
 *
 * Idempotency: Vercel Cron's own delivery is best-effort and can invoke the
 * same scheduled run more than once (per Vercel's own docs). The real
 * defense against a double-send is the pre-check against
 * `saas_billing_notices` in `alreadyNotified()` below (checked *before*
 * sending, not just at insert time -- a unique-index conflict alone would
 * only stop the duplicate DB row, not the duplicate message that already
 * went out). Each due gym is processed in its own try/catch so one gym's
 * failure (or a rare insert race) does not abort the run for every other
 * due gym.
 */
import type { NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEvolutionApiMessage } from "@/lib/messaging/EvolutionApiMessageProvider";
import { sendTwilioSms } from "@/lib/messaging/sendTwilioSms";
import { isSaasBillingRemindersEnabled } from "@/lib/featureFlags";
import en from "@/locales/en.json";
import fr from "@/locales/fr.json";

// No `export const dynamic` route-segment config -- incompatible with this
// project's Cache Components model (Next.js 16). Not needed anyway: this
// handler reads `request.headers` and makes DB/RPC calls, both of which
// already force it to run at request time by default under Cache
// Components (see node_modules/next/dist/docs/01-app/01-getting-started/
// 15-route-handlers.md's "With Cache Components" section, confirmed at
// implementation time, not assumed from training data -- this Next.js
// version's own AGENTS.md flags exactly this kind of behavior change).

// FR-133: the default 1/3/5-day-after-due reminder schedule, plus 0 (the
// due date itself, AC #1's "when it arrives").
const REMINDER_OFFSETS = [0, 1, 3, 5] as const;

const REMINDER_MESSAGE_BY_LOCALE: Record<string, string> = {
  en: en.saasBilling.reminderMessage,
  fr: fr.saasBilling.reminderMessage,
};

type DueGym = {
  id: string;
  saas_billing_anchor_date: string;
  offset: number;
};

type OwnerRow = {
  phone: string | null;
  email: string | null;
  user_id: string;
};

function isoDateDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

// AC #5: this composed copy is the literal EXPERIENCE.md Voice-and-Tone
// string -- an explicit imperative ("Pay now"), never language implying an
// automatic charge (mobile money is never auto-debited, OQ-14).
function composeReminderMessage(locale: string, dueDate: string): string {
  const template = REMINDER_MESSAGE_BY_LOCALE[locale] ?? REMINDER_MESSAGE_BY_LOCALE.en;
  const url = `${process.env.DASHBOARD_APP_URL ?? ""}/settings`;
  return template.replace("{{date}}", dueDate).replace("{{url}}", url);
}

async function findDueGyms(admin: ReturnType<typeof createAdminClient>): Promise<DueGym[]> {
  const dueGyms: DueGym[] = [];

  for (const offset of REMINDER_OFFSETS) {
    const targetAnchorDate = isoDateDaysAgo(offset);
    // Excludes deactivated gyms (Story 11.2's own precedent -- a manually
    // deactivated gym shouldn't get a billing text either) and gyms already
    // `suspended` (Story 11.4's suspension-recovery UI, not a reminder
    // text, is the right surface once suspended -- see this story's Task 4
    // Dev Notes).
    const { data, error } = await admin
      .from("gyms")
      .select("id, saas_billing_anchor_date")
      .eq("saas_billing_anchor_date", targetAnchorDate)
      .neq("status", "deactivated")
      .neq("saas_billing_status", "suspended");

    if (error) {
      throw new Error(`saas_billing_reminders: due-gym query failed for offset ${offset}: ${error.message}`);
    }

    for (const row of (data ?? []) as { id: string; saas_billing_anchor_date: string }[]) {
      dueGyms.push({ id: row.id, saas_billing_anchor_date: row.saas_billing_anchor_date, offset });
    }
  }

  return dueGyms;
}

async function alreadyNotified(admin: ReturnType<typeof createAdminClient>, gym: DueGym): Promise<boolean> {
  const { data, error } = await admin
    .from("saas_billing_notices")
    .select("id")
    .eq("gym_id", gym.id)
    .eq("billing_anchor_date_at_notice", gym.saas_billing_anchor_date)
    .eq("notice_day_offset", gym.offset)
    .maybeSingle();

  if (error) {
    throw new Error(`saas_billing_reminders: notice dedup check failed for gym ${gym.id}: ${error.message}`);
  }

  return data !== null;
}

async function notifyGym(admin: ReturnType<typeof createAdminClient>, gym: DueGym): Promise<void> {
  // Flag, not assumed: nothing in the schema prevents a gym from having more
  // than one owner-role member -- every active one is notified, not just
  // the first, since a missed payment-due notice risks the whole team
  // losing access (AC #5).
  const { data: ownerRows, error: ownersError } = await admin
    .from("members")
    .select("phone, email, user_id")
    .eq("gym_id", gym.id)
    .eq("role", "owner")
    .is("deactivated_at", null);

  if (ownersError) {
    throw new Error(`saas_billing_reminders: owner lookup failed for gym ${gym.id}: ${ownersError.message}`);
  }

  const owners = (ownerRows ?? []) as OwnerRow[];
  if (owners.length === 0) {
    // No active owner-role member to notify -- nothing sent, nothing to
    // record for this (gym, offset).
    return;
  }

  const userIds = owners.map((owner) => owner.user_id);
  const { data: userRows, error: usersError } = await admin
    .from("users")
    .select("id, preferred_language")
    .in("id", userIds);

  if (usersError) {
    throw new Error(`saas_billing_reminders: locale lookup failed for gym ${gym.id}: ${usersError.message}`);
  }

  const localeByUserId = new Map<string, string>();
  for (const row of (userRows ?? []) as { id: string; preferred_language: string | null }[]) {
    localeByUserId.set(row.id, row.preferred_language ?? "en");
  }

  let whatsappSent = false;
  let whatsappError: string | null = null;
  let smsSent = false;
  let smsError: string | null = null;
  let hasEmailOnFile = false;

  for (const owner of owners) {
    if (owner.email) {
      hasEmailOnFile = true;
    }

    if (!owner.phone) {
      console.error(`saas_billing_reminders: owner ${owner.user_id} in gym ${gym.id} has no phone on file -- skipped`);
      continue;
    }

    const locale = localeByUserId.get(owner.user_id) ?? "en";
    const message = composeReminderMessage(locale, gym.saas_billing_anchor_date);

    // AC #1: both channels fire unconditionally -- not a fallback chain
    // (AD-11 doesn't apply here). Sequential, not Promise.all, so a slow
    // WhatsApp send never delays the SMS attempt's own timeout budget.
    const whatsappResult = await sendEvolutionApiMessage(owner.phone, message);
    if (whatsappResult.success) {
      whatsappSent = true;
    } else if (!whatsappError) {
      whatsappError = whatsappResult.error;
    }

    const smsResult = await sendTwilioSms(owner.phone, message);
    if (smsResult.success) {
      smsSent = true;
    } else if (!smsError) {
      smsError = smsResult.error;
    }
  }

  // AC #2: email is a best-effort third channel, but no transactional email
  // provider exists in this stack yet (prd.md addendum §A) -- this is a
  // deliberate, honest no-op recorded as `skipped_no_provider`/
  // `skipped_no_email_on_file`, never a fabricated success or a silent gap.
  const emailStatus = hasEmailOnFile ? "skipped_no_provider" : "skipped_no_email_on_file";

  // One row per (gym, offset), not per owner -- multiple owners' individual
  // outcomes are aggregated ("sent" if at least one owner's send on that
  // channel succeeded; the first error seen is kept for diagnostics).
  const { error: insertError } = await admin.from("saas_billing_notices").insert({
    gym_id: gym.id,
    notice_day_offset: gym.offset,
    billing_anchor_date_at_notice: gym.saas_billing_anchor_date,
    sms_status: smsSent ? "sent" : "failed",
    sms_error: smsSent ? null : smsError,
    whatsapp_status: whatsappSent ? "sent" : "failed",
    whatsapp_error: whatsappSent ? null : whatsappError,
    email_status: emailStatus,
    email_error: null,
  });

  if (insertError) {
    // A unique-violation here means a concurrent/duplicate Vercel Cron
    // invocation already recorded this exact (gym, cycle, offset) notice
    // after our own pre-check ran above -- see this file's header comment.
    console.error(`saas_billing_reminders: failed to record notice for gym ${gym.id} offset ${gym.offset}`, insertError);
  }
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  if (!isSaasBillingRemindersEnabled()) {
    return Response.json({ success: true, sent: 0, skipped: 0, failed: 0, disabled: true });
  }

  const admin = createAdminClient();
  const startedAt = new Date().toISOString();

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  try {
    const dueGyms = await findDueGyms(admin);

    for (const gym of dueGyms) {
      try {
        if (await alreadyNotified(admin, gym)) {
          skipped++;
          continue;
        }
        await notifyGym(admin, gym);
        sent++;
      } catch (err) {
        console.error(`saas_billing_reminders: failed to process gym ${gym.id} offset ${gym.offset}`, err);
        failed++;
      }
    }

    await admin.from("job_runs").insert({
      job_name: "saas_billing_reminders",
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      status: "success",
    });

    return Response.json({ success: true, sent, skipped, failed });
  } catch (err) {
    const error = err instanceof Error ? err.message : "saas_billing_reminders job failed";
    await admin.from("job_runs").insert({
      job_name: "saas_billing_reminders",
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      status: "failure",
      error,
    });
    return Response.json({ success: false, error }, { status: 500 });
  }
}
