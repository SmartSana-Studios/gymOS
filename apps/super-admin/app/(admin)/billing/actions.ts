"use server";

import { applyCreditSchema, gymIdSchema, type AppError } from "@gymos/types";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logGymLifecycleEvent, mapAndLog } from "@/services/gyms";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getServerTranslation } from "@/lib/i18n/get-server-translation";
import { sendEvolutionApiMessage } from "@/lib/messaging/EvolutionApiMessageProvider";
import { sendTwilioSms } from "@/lib/messaging/sendTwilioSms";
import en from "@/locales/en.json";
import fr from "@/locales/fr.json";

/**
 * "Mark payment received (out-of-band)" (AC #2). Takes no input beyond
 * gymId -- SA-07's confirm dialog for this action is confirm-only, no
 * reason/amount field. Calls the Task 1 RPC (self-enforces
 * private.is_super_admin() and the deactivated-gym guard internally, AD-5),
 * then audit-logs the RPC's own resolved amount/anchor-date values.
 */
export async function markPaymentReceived(gymId: string): Promise<{ error: AppError | null }> {
  const { t } = await getServerTranslation(await getRequestLocale());
  if (!gymIdSchema.safeParse(gymId).success) {
    return { error: { code: "validation_error", message: t("gyms.errors.invalidGymId") } };
  }

  const supabase = await createClient();
  const { data: rows, error } = await supabase.rpc("record_out_of_band_saas_billing_payment", {
    p_gym_id: gymId,
  });
  if (error || !rows || rows.length === 0) {
    return { error: await mapAndLog(error) };
  }
  const result = rows[0] as {
    id: string;
    amount: number;
    previous_anchor_date: string;
    new_anchor_date: string;
  };

  const { error: auditError } = await logGymLifecycleEvent("saas_payment_marked_received", gymId, {
    saas_billing_payment_id: result.id,
    amount: result.amount,
    previous_anchor_date: result.previous_anchor_date,
    new_anchor_date: result.new_anchor_date,
  });
  if (auditError) {
    return {
      error: { code: "audit_log_failed", message: t("billing.errors.auditLogFailedPaymentReceived") },
    };
  }

  return { error: null };
}

/**
 * "Apply credit / free period" (AC #2). `input.days` is always a resolved
 * day count by the time it reaches this action -- the UI resolves SA-07's
 * "N days or one billing cycle" choice to a concrete number before
 * submitting (see BillingPageClient.tsx).
 */
export async function applyCredit(
  gymId: string,
  input: unknown,
): Promise<{ error: AppError | null }> {
  const { t } = await getServerTranslation(await getRequestLocale());
  if (!gymIdSchema.safeParse(gymId).success) {
    return { error: { code: "validation_error", message: t("gyms.errors.invalidGymId") } };
  }

  const parsed = applyCreditSchema.safeParse(input);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    // Review fix: substitute the localized key for the `days` field's
    // validation failure -- see ApplyCreditDialog.tsx's identical fix.
    const message =
      firstIssue?.path[0] === "days"
        ? t("billing.applyCredit.errors.daysPositive")
        : (firstIssue?.message ?? t("common.invalidInput"));
    return { error: { code: "validation_error", message } };
  }

  const supabase = await createClient();
  const { data: rows, error } = await supabase.rpc("apply_saas_billing_credit", {
    p_gym_id: gymId,
    p_days: parsed.data.days,
  });
  if (error || !rows || rows.length === 0) {
    return { error: await mapAndLog(error) };
  }
  const result = rows[0] as { previous_anchor_date: string; new_anchor_date: string };

  const { error: auditError } = await logGymLifecycleEvent("saas_billing_credit_applied", gymId, {
    days: parsed.data.days,
    reason: parsed.data.reason,
    previous_anchor_date: result.previous_anchor_date,
    new_anchor_date: result.new_anchor_date,
  });
  if (auditError) {
    return { error: { code: "audit_log_failed", message: t("billing.errors.auditLogFailedCredit") } };
  }

  return { error: null };
}

/**
 * Origin of apps/dashboard, for the retry message's payment link. Not
 * imported from gyms/actions.ts's own identical (unexported) helper --
 * within-app duplication of a 4-line env read is this codebase's own
 * established tolerance for this exact pattern (see that file's own
 * getDashboardAppUrl(), and apps/dashboard's saas-billing-reminders route
 * handler, which duplicates the same helper one file over from
 * services/staff.ts for the identical reason).
 */
function getDashboardAppUrl(): string {
  const url = process.env.DASHBOARD_APP_URL;
  if (!url) {
    throw new Error("DASHBOARD_APP_URL is not set");
  }
  return url.replace(/\/+$/, "");
}

const RETRY_MESSAGE_BY_LOCALE: Record<string, string> = {
  en: en.billing.retryMessage,
  fr: fr.billing.retryMessage,
};

const RETRY_MESSAGE_NO_LINK_BY_LOCALE: Record<string, string> = {
  en: en.billing.retryMessageNoLink,
  fr: fr.billing.retryMessageNoLink,
};

/** Same composition shape as apps/dashboard's own composeReminderMessage()
 * (saas-billing-reminders route) -- {{date}}/{{url}} substitution, a
 * no-link fallback template when DASHBOARD_APP_URL is unset so a
 * misconfigured env var never ships a broken link. */
function composeRetryMessage(locale: string, dueDate: string): string {
  const resolvedLocale = locale in RETRY_MESSAGE_BY_LOCALE ? locale : "en";

  let url = "";
  try {
    url = `${getDashboardAppUrl()}/settings`;
  } catch (err) {
    console.error(
      "triggerRetry: DASHBOARD_APP_URL is not set; sending retry without a payment link",
      err,
    );
  }

  const template = url ? RETRY_MESSAGE_BY_LOCALE[resolvedLocale] : RETRY_MESSAGE_NO_LINK_BY_LOCALE[resolvedLocale];
  return template.replaceAll("{{date}}", dueDate).replaceAll("{{url}}", url);
}

/**
 * "Trigger retry" (AC #2): manually re-sends a payment-due notice outside
 * the normal reminder schedule. Reuses apps/dashboard's saas-billing-
 * reminders route's own owner-lookup/per-owner-locale/both-channels-fire
 * shape (Story 11.3's notifyGym()), ported here (not called into) per this
 * story's Dev Notes decision -- duplicating the send helpers rather than
 * adding a new cross-app HTTP surface (AD-7 precedent, user-confirmed at
 * dev-story time). Does NOT write to saas_billing_notices -- that table's
 * notice_day_offset CHECK (0,1,3,5) is tied to the *scheduled* reminder
 * days; a manual retry has no such offset, and widening the constraint
 * would risk notifyGym()'s own dedup semantics. The outcome is instead
 * recorded via log_audit_event() metadata (AC #3).
 *
 * Uses the admin client (service-role), mirroring the cron route's own
 * choice -- this reads across every gym's members/users rows, which a
 * Super Admin's own RLS-scoped session cannot do directly (members is
 * scoped to role='owner' rows only, and `users` has no Super-Admin-read
 * policy at all).
 */
export async function triggerRetry(gymId: string): Promise<{ error: AppError | null }> {
  const { t } = await getServerTranslation(await getRequestLocale());
  if (!gymIdSchema.safeParse(gymId).success) {
    return { error: { code: "validation_error", message: t("gyms.errors.invalidGymId") } };
  }

  const admin = createAdminClient();

  const { data: gym, error: gymError } = await admin
    .from("gyms")
    .select("saas_billing_anchor_date")
    .eq("id", gymId)
    .maybeSingle();
  if (gymError) {
    return { error: await mapAndLog(gymError) };
  }
  if (!gym) {
    return { error: { code: "not_found", message: t("gyms.errors.gymNotFound") } };
  }

  const { data: ownerRows, error: ownersError } = await admin
    .from("members")
    .select("phone, user_id")
    .eq("gym_id", gymId)
    .eq("role", "owner")
    .is("deactivated_at", null);
  if (ownersError) {
    return { error: await mapAndLog(ownersError) };
  }

  const owners = (ownerRows ?? []) as { phone: string | null; user_id: string }[];
  const ownersWithPhone = owners.filter(
    (owner): owner is { phone: string; user_id: string } => !!owner.phone,
  );

  if (ownersWithPhone.length === 0) {
    // Review fix: nothing is sent on this path -- log the attempt, but
    // always surface "no owner phone" (never the generic "sent, but audit
    // failed" message, which would be false here regardless of whether the
    // audit write itself succeeds).
    await logGymLifecycleEvent("saas_billing_retry_triggered", gymId, {
      channels_attempted: [],
      channels_sent: [],
      skipped_reason: "no_owner_phone",
    });
    return { error: { code: "no_owner_phone", message: t("billing.errors.noOwnerPhone") } };
  }

  const userIds = ownersWithPhone.map((owner) => owner.user_id);
  const { data: userRows, error: usersError } = await admin
    .from("users")
    .select("id, preferred_language")
    .in("id", userIds);
  if (usersError) {
    return { error: await mapAndLog(usersError) };
  }

  const localeByUserId = new Map<string, string>();
  for (const row of (userRows ?? []) as { id: string; preferred_language: string | null }[]) {
    localeByUserId.set(row.id, row.preferred_language ?? "en");
  }

  // Review fix: per-owner outcomes are now tracked in full (not just the
  // first failure per channel), so a partial failure among 2+ owners is
  // still visible in the audit log even when the channel overall "sent"
  // (i.e. at least one owner's send succeeded).
  const ownerResults: {
    userId: string;
    whatsappSuccess: boolean;
    whatsappError: string | null;
    smsSuccess: boolean;
    smsError: string | null;
  }[] = [];

  // Sequential, not Promise.all, mirroring notifyGym()'s own reasoning: a
  // slow WhatsApp send must not delay the SMS attempt's own timeout budget.
  for (const owner of ownersWithPhone) {
    const locale = localeByUserId.get(owner.user_id) ?? "en";
    const message = composeRetryMessage(locale, gym.saas_billing_anchor_date);

    const whatsappResult = await sendEvolutionApiMessage(owner.phone, message);
    const smsResult = await sendTwilioSms(owner.phone, message);

    ownerResults.push({
      userId: owner.user_id,
      whatsappSuccess: whatsappResult.success,
      whatsappError: whatsappResult.success ? null : whatsappResult.error,
      smsSuccess: smsResult.success,
      smsError: smsResult.success ? null : smsResult.error,
    });
  }

  const whatsappSent = ownerResults.some((r) => r.whatsappSuccess);
  const smsSent = ownerResults.some((r) => r.smsSuccess);
  const whatsappErrors = ownerResults
    .filter((r) => !r.whatsappSuccess)
    .map((r) => r.whatsappError)
    .filter((e): e is string => e !== null);
  const smsErrors = ownerResults
    .filter((r) => !r.smsSuccess)
    .map((r) => r.smsError)
    .filter((e): e is string => e !== null);

  const channelsSent = [whatsappSent ? "whatsapp" : null, smsSent ? "sms" : null].filter(
    (v): v is string => v !== null,
  );
  const totalFailure = !whatsappSent && !smsSent;

  const { error: auditError } = await logGymLifecycleEvent("saas_billing_retry_triggered", gymId, {
    channels_attempted: ["whatsapp", "sms"],
    channels_sent: channelsSent,
    owners_attempted: ownersWithPhone.length,
    whatsapp_errors: whatsappErrors.length > 0 ? whatsappErrors : null,
    sms_errors: smsErrors.length > 0 ? smsErrors : null,
  });

  // Review fix: a failed audit-log write must never upgrade a total-failure
  // outcome into "the reminder was sent, but..." -- check totalFailure
  // first regardless of whether the audit write itself also failed.
  if (totalFailure) {
    return { error: { code: "retry_send_failed", message: t("billing.errors.retrySendFailed") } };
  }
  if (auditError) {
    return { error: { code: "audit_log_failed", message: t("billing.errors.auditLogFailedRetry") } };
  }

  return { error: null };
}
