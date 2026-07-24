import { createClient } from "@/lib/supabase/server";
import { renewSubscriptionSchema, type RenewSubscriptionInput, type AppError } from "@gymos/types";
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
