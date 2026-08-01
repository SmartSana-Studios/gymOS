import { createClient } from "@/lib/supabase/server";
import {
  confirmRenewalSchema,
  renewSubscriptionSchema,
  type ConfirmRenewalInput,
  type RenewSubscriptionInput,
  type AppError,
} from "@gymos/types";
import { mapAndLog } from "@/services/session";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getServerTranslation } from "@/lib/i18n/get-server-translation";

/** Story 3.2: Manual Renewal Reset. Backend-only story (no `actions.ts`/UI
 * yet -- Epic 4 Stories 4.7/4.8 own that) -- this service function is
 * currently the outermost boundary receiving this input, so it validates
 * here rather than trusting an already-parsed caller the way most other
 * service functions in this file do (e.g. `insertSubscription`), matching
 * `createMember`'s `actions.ts`-layer validate-then-map-generic-error
 * pattern since no `actions.ts` exists yet to own that step. Calls the
 * `renew_subscription()` SECURITY DEFINER RPC (0022_manual_renewal_reset.sql),
 * which does the real work (INSERTs a new `subscriptions` row rather than
 * mutating the member's existing one -- renewal-as-history, not
 * renewal-as-mutation) and self-enforces the owner/manager/receptionist role
 * check internally. */
export async function renewSubscription(
  input: RenewSubscriptionInput,
): Promise<{ data: { id: string } | null; error: AppError | null }> {
  const { t } = await getServerTranslation(await getRequestLocale());
  const parsed = renewSubscriptionSchema.safeParse(input);
  if (!parsed.success) {
    return {
      data: null,
      error: { code: "validation_error", message: t("common.invalidInput") },
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("renew_subscription", {
    p_member_id: parsed.data.memberId,
    p_reason: parsed.data.reason,
  });

  if (error || !data) {
    return { data: null, error: await mapAndLog(error) };
  }

  return { data: { id: data as unknown as string }, error: null };
}

// ============================================================================
// Story 4.7: Inline Renewal Panel. `confirmRenewal` calls the new atomic
// `confirm_renewal()` RPC (0035_inline_renewal_panel.sql -- see that
// migration's own comment for why this is one function, not
// renewSubscription + recordManualPayment called back-to-back).
// `getRenewalPreview` is a plain read backing the panel's pre-population
// (AC #1) -- this file's first non-RPC table query, so it needs its own
// `gym_id` claim resolution; copied verbatim from payments.ts's
// getCallerGymId rather than a cross-import, matching that file's own
// established per-file-copy discipline.
// ============================================================================

async function getCallerGymId(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<{ gymId: string | null; error: AppError | null }> {
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();

  if (claimsError) {
    return { gymId: null, error: await mapAndLog(claimsError) };
  }

  const claims = claimsData?.claims as { gym_id?: string } | undefined;
  const gymId = claims?.gym_id ?? null;
  if (!gymId) {
    console.warn("[subscriptions] getCallerGymId: no gym_id claim on caller's session");
    const { t } = await getServerTranslation(await getRequestLocale());
    return { gymId: null, error: { code: "not_found", message: t("common.somethingWentWrong") } };
  }

  return { gymId, error: null };
}

export interface ConfirmedRenewal {
  paymentId: string;
  subscriptionId: string;
  amount: number;
  currency: string;
  newExpiryDate: string | null;
}

interface ConfirmRenewalRpcRow {
  payment_id: string;
  subscription_id: string;
  amount: number;
  currency: string;
  new_expiry_date: string | null;
}

/**
 * AC #2, #3: validates via `confirmRenewalSchema`, calls `confirm_renewal()`.
 * `confirm_renewal` uses `out` parameters (not `returns table(...)`), so
 * Supabase's generated type is an untyped `Record<string, unknown>` --
 * cast to the row shape below, mirroring `renewSubscription`'s own
 * `data as unknown as string` precedent for the same reason.
 */
export async function confirmRenewal(
  input: ConfirmRenewalInput,
): Promise<{ data: ConfirmedRenewal | null; error: AppError | null }> {
  const { t } = await getServerTranslation(await getRequestLocale());
  const parsed = confirmRenewalSchema.safeParse(input);
  if (!parsed.success) {
    return {
      data: null,
      error: { code: "validation_error", message: t("common.invalidInput") },
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("confirm_renewal", {
    p_member_id: parsed.data.memberId,
    p_method: parsed.data.method,
    p_reason: parsed.data.reason,
  });

  if (error || !data) {
    return { data: null, error: await mapAndLog(error) };
  }

  const row = data as unknown as ConfirmRenewalRpcRow;

  return {
    data: {
      paymentId: row.payment_id,
      subscriptionId: row.subscription_id,
      amount: row.amount,
      currency: row.currency,
      newExpiryDate: row.new_expiry_date,
    },
    error: null,
  };
}

export interface RenewalPreview {
  planName: string;
  price: number;
  currency: string;
}

interface RenewalPreviewRowFromDb {
  plans: { name: string; price: number; currency: string } | null;
}

/**
 * AC #1: backs the panel's pre-population. Read-only, same "most recent
 * subscription -> plan" join pattern as `initiatePayment`
 * (apps/dashboard/services/payments.ts:79-86). A `null` plan (member has no
 * subscription at all) maps to a `not_found` AppError -- the panel shows
 * this as its own inline error state (Task 6), even though this specific
 * failure happens on open, not on confirm.
 */
export async function getRenewalPreview(
  memberId: string,
): Promise<{ data: RenewalPreview | null; error: AppError | null }> {
  const { t } = await getServerTranslation(await getRequestLocale());
  const supabase = await createClient();
  const { gymId, error: gymIdError } = await getCallerGymId(supabase);
  if (gymIdError || !gymId) {
    return { data: null, error: gymIdError };
  }

  const { data, error } = await supabase
    .from("subscriptions")
    .select("plans(name, price, currency)")
    .eq("gym_id", gymId)
    .eq("member_id", memberId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return { data: null, error: await mapAndLog(error) };
  }

  const plan = (data as unknown as RenewalPreviewRowFromDb | null)?.plans ?? null;
  if (!plan) {
    console.warn(`[subscriptions] getRenewalPreview: member ${memberId} has no subscription/plan to preview`);
    return { data: null, error: { code: "not_found", message: t("renewalPanel.errors.noActivePlan") } };
  }

  return { data: { planName: plan.name, price: plan.price, currency: plan.currency }, error: null };
}
