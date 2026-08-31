import { createClient } from "@/lib/supabase/server";
import { FunctionsHttpError } from "@supabase/supabase-js";
import type { AppError } from "@gymos/types";
import { mapAndLog } from "@/services/session";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getServerTranslation } from "@/lib/i18n/get-server-translation";

/**
 * Story 11.3 (Task 6): the Owner's own GymOS (Flow B) billing relationship
 * -- distinct from `gym-payment-credentials.ts` (Flow A, the gym's own Tara
 * Money account members pay into) and `payments.ts` (Flow A payment
 * initiation). Kept in its own file, matching this app's established
 * per-feature-file convention.
 */

/** Copied verbatim from `payments.ts`'s own (unexported) helper -- this
 * app's established per-file-copy discipline for the caller's-own-gym_id
 * lookup, rather than reaching across service files. */
async function getCallerGymId(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<{ gymId: string | null; actorId: string | null; error: AppError | null }> {
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();

  if (claimsError) {
    return { gymId: null, actorId: null, error: await mapAndLog(claimsError) };
  }

  const claims = claimsData?.claims as { gym_id?: string; sub?: string } | undefined;
  const gymId = claims?.gym_id ?? null;
  const actorId = claims?.sub ?? null;
  if (!gymId) {
    console.warn("[billing] getCallerGymId: no gym_id claim on caller's session");
    const { t } = await getServerTranslation(await getRequestLocale());
    return { gymId: null, actorId, error: { code: "not_found", message: t("common.somethingWentWrong") } };
  }

  return { gymId, actorId, error: null };
}

export type SaasBillingStatus = "active" | "past_due" | "grace_period" | "suspended";
export type SaasBillingInterval = "monthly" | "annual";

export interface SelectableTier {
  id: string;
  name: string;
  monthlyPrice: number;
  annualPrice: number;
}

/**
 * Story 11.7 (Task 4): the Pay-Now tier selector's read path.
 * `list_selectable_saas_billing_tiers()` (0077) is a SECURITY DEFINER RPC,
 * not a direct `tiers` table read -- `tiers` has no SELECT policy for a
 * gym-scoped session (super_admin_read_tiers is the only one, 0010).
 * price_locked (Free/Test) rows are excluded server-side, not filtered here.
 */
export async function listSelectableTiers(): Promise<{ data: SelectableTier[] | null; error: AppError | null }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_selectable_saas_billing_tiers");
  if (error) {
    return { data: null, error: await mapAndLog(error) };
  }
  return {
    data: (data ?? []).map((row: { id: string; name: string; monthly_price: number; annual_price: number }) => ({
      id: row.id,
      name: row.name,
      monthlyPrice: row.monthly_price,
      annualPrice: row.annual_price,
    })),
    error: null,
  };
}

export interface GymBillingInfo {
  tierName: string;
  interval: SaasBillingInterval;
  billingStatus: SaasBillingStatus;
  anchorDate: string;
  notificationEmail: string | null;
  ownerPhone: string | null;
}

interface GymBillingRow {
  saas_billing_status: SaasBillingStatus;
  saas_billing_interval: SaasBillingInterval;
  saas_billing_anchor_date: string;
  tiers: { name: string } | null;
}

/**
 * Read path for Task 6's new Billing settings section -- current tier
 * name/interval/status/next billing date, the caller's own notification
 * email (pre-fills the email field, `members.email` --
 * `update_own_owner_notification_email()`'s own target column), and the
 * caller's own on-file phone (pre-fills, but does not lock, the "Pay Now"
 * payer-number field -- live-evidence finding: the Owner's on-file number
 * isn't always the right mobile-money payer line).
 */
export async function getGymBillingInfo(): Promise<{ data: GymBillingInfo | null; error: AppError | null }> {
  const supabase = await createClient();
  const { gymId, actorId, error: gymIdError } = await getCallerGymId(supabase);
  if (gymIdError || !gymId || !actorId) {
    return { data: null, error: gymIdError };
  }

  // `tiers` embeds as a single object -- gyms.tier_id -> tiers is a
  // many-to-one FK, same join shape payments.ts's own subscriptions ->
  // plans lookup uses.
  const { data: gymRow, error: gymError } = await supabase
    .from("gyms")
    .select("saas_billing_status, saas_billing_interval, saas_billing_anchor_date, tiers(name)")
    .eq("id", gymId)
    .maybeSingle();

  if (gymError) {
    return { data: null, error: await mapAndLog(gymError) };
  }
  if (!gymRow) {
    const { t } = await getServerTranslation(await getRequestLocale());
    return { data: null, error: { code: "not_found", message: t("settings.errors.gymNotFound") } };
  }

  const row = gymRow as unknown as GymBillingRow;

  const { data: ownerRow, error: ownerError } = await supabase
    .from("members")
    .select("email, phone")
    .eq("user_id", actorId)
    .eq("gym_id", gymId)
    .eq("role", "owner")
    .is("deactivated_at", null)
    .maybeSingle();

  if (ownerError) {
    return { data: null, error: await mapAndLog(ownerError) };
  }

  return {
    data: {
      tierName: row.tiers?.name ?? "",
      interval: row.saas_billing_interval,
      billingStatus: row.saas_billing_status,
      anchorDate: row.saas_billing_anchor_date,
      notificationEmail: ownerRow?.email ?? null,
      ownerPhone: ownerRow?.phone ?? null,
    },
    error: null,
  };
}

/**
 * "Pay Now" -- calls `initiate_saas_billing_payment()` (self-scoped,
 * server-derives amount/gym from the caller's own session) then the same
 * shared `payment-webhook/initiate/<providerKey>` route Flow A's
 * `initiatePayment()` (payments.ts) already uses, mirroring that function's
 * shape exactly (strip the leading `+` from the phone the same way, map the
 * Edge Function's `code` field out of `FunctionsHttpError` the same way).
 *
 * `phoneNumber` is caller-supplied (validated by `initiateSaasBillingPaymentSchema`
 * at the Server Action boundary), not looked up from `members.phone` here --
 * live-evidence finding (real user testing): the Owner's own on-file number
 * isn't always the right mobile-money payer line, so the UI presents an
 * editable field (pre-filled from `getGymBillingInfo()`'s `ownerPhone`)
 * instead of Story 4.15's original "member's own number, no input needed"
 * precedent.
 *
 * `tierId`/`interval` (Story 11.7, AC #1): an optional Pay-Now tier/interval
 * override, passed straight through to `initiate_saas_billing_payment()`'s
 * own `coalesce(p_tier_id, gym's own tier_id)` defaulting -- undefined means
 * "re-pay whatever's already on `gyms`", matching the pre-11.7 behavior.
 */
export async function initiateSaasBillingPayment(
  phoneNumber: string,
  tierId?: string,
  interval?: SaasBillingInterval,
): Promise<{
  data: { paymentId: string } | null;
  error: AppError | null;
}> {
  const { t } = await getServerTranslation(await getRequestLocale());
  const supabase = await createClient();
  const { gymId, error: gymIdError } = await getCallerGymId(supabase);
  if (gymIdError || !gymId) {
    return { data: null, error: gymIdError };
  }

  const { data: providerKey, error: providerError } = await supabase.rpc("active_payment_provider");
  if (providerError) {
    return { data: null, error: await mapAndLog(providerError) };
  }
  if (!providerKey) {
    console.error("[billing] initiateSaasBillingPayment: no active_payment_provider() configured");
    return { data: null, error: { code: "not_found", message: t("common.somethingWentWrong") } };
  }

  const { data: paymentId, error: rpcError } = await supabase.rpc("initiate_saas_billing_payment", {
    p_tier_id: tierId ?? null,
    p_interval: interval ?? null,
  });
  if (rpcError || !paymentId) {
    return { data: null, error: await mapAndLog(rpcError) };
  }

  const bareDigitPhone = phoneNumber.replace(/^\+/, "");

  const { error: invokeError } = await supabase.functions.invoke(`payment-webhook/initiate/${providerKey}`, {
    body: { paymentId, phoneNumber: bareDigitPhone },
  });

  if (invokeError) {
    console.error(
      `[billing] initiateSaasBillingPayment: payment-webhook initiate failed for payment ${paymentId}`,
      invokeError,
    );

    if (invokeError instanceof FunctionsHttpError) {
      let code: string | undefined;
      try {
        code = (await invokeError.context.json())?.code;
      } catch {
        // Non-JSON or unreadable body -- falls through to the generic
        // mapAndLog(invokeError) below.
      }
      if (code === "gym_credentials_unavailable") {
        return {
          data: null,
          error: { code: "gym_credentials_unavailable", message: t("payments.errors.gymCredentialsUnavailable") },
        };
      }
    }

    return { data: null, error: await mapAndLog(invokeError) };
  }

  return { data: { paymentId }, error: null };
}

/**
 * Story 11.7 (AC #3): "Continue on Tara" -- creates the same `processing`
 * row `initiateSaasBillingPayment` does (tier/interval recording, the
 * double-submit guard, all shared via the same `initiate_saas_billing_payment()`
 * RPC), then calls the new `payment-webhook/initiate-link/<providerKey>`
 * route instead of `initiate/<providerKey>` -- dispatches to
 * `createHostedCheckoutLink()` instead of `initiate()`, no `phoneNumber`
 * (the hosted page collects payment details itself).
 */
export async function createSaasBillingHostedCheckoutLink(
  tierId?: string,
  interval?: SaasBillingInterval,
): Promise<{
  data: { paymentId: string; checkoutUrl: string } | null;
  error: AppError | null;
}> {
  const { t } = await getServerTranslation(await getRequestLocale());
  const supabase = await createClient();
  const { gymId, error: gymIdError } = await getCallerGymId(supabase);
  if (gymIdError || !gymId) {
    return { data: null, error: gymIdError };
  }

  const { data: providerKey, error: providerError } = await supabase.rpc("active_payment_provider");
  if (providerError) {
    return { data: null, error: await mapAndLog(providerError) };
  }
  if (!providerKey) {
    console.error("[billing] createSaasBillingHostedCheckoutLink: no active_payment_provider() configured");
    return { data: null, error: { code: "not_found", message: t("common.somethingWentWrong") } };
  }

  const { data: paymentId, error: rpcError } = await supabase.rpc("initiate_saas_billing_payment", {
    p_tier_id: tierId ?? null,
    p_interval: interval ?? null,
  });
  if (rpcError || !paymentId) {
    return { data: null, error: await mapAndLog(rpcError) };
  }

  const { data: invokeData, error: invokeError } = await supabase.functions.invoke(`payment-webhook/initiate-link/${providerKey}`, {
    body: { paymentId },
  });

  if (invokeError || !invokeData?.checkoutUrl) {
    console.error(
      `[billing] createSaasBillingHostedCheckoutLink: payment-webhook initiate-link failed for payment ${paymentId}`,
      invokeError,
    );
    return { data: null, error: await mapAndLog(invokeError) };
  }

  return { data: { paymentId, checkoutUrl: invokeData.checkoutUrl }, error: null };
}

/**
 * Sets/clears the caller's own notification email --
 * `update_own_owner_notification_email()` itself is the real authorization
 * boundary (SECURITY DEFINER, owner-only, self-scoped); this function only
 * relays the call.
 */
export async function updateOwnerNotificationEmail(
  email: string | null,
): Promise<{ data: { ok: true } | null; error: AppError | null }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_own_owner_notification_email", { p_email: email });
  if (error) {
    return { data: null, error: await mapAndLog(error) };
  }
  return { data: { ok: true }, error: null };
}
