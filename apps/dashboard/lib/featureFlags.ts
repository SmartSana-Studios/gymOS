import type { AppError } from "@gymos/types";
import { getGymPaymentConnectionStatus } from "@/services/gym-payment-credentials";

/** The one `payment_providers.provider_key` this codebase currently
 * integrates -- shared here (rather than re-typed as a bare string literal
 * at every call site) so a future rename or multi-provider expansion is a
 * one-line change, not a scattershot find-and-replace. */
export const TARAMONEY_PROVIDER_KEY = "taramoney";

/**
 * Story 4.12 (AC #4): the reversibility "kill switch" for automated Tara
 * Money Mobile Money initiation -- decided as a UI-level, env-var-gated flag
 * rather than a `payment_providers` schema change (`activate_payment_provider()`
 * cannot express "zero active providers"; see the story file's AC #4 Reality
 * note). Server-only (reads a non-`NEXT_PUBLIC_` env var) -- default enabled
 * (`true`) unless explicitly set to `"false"` (case/whitespace-insensitive).
 *
 * Review finding (Story 4.12): previously re-typed identically at 4 call
 * sites (`payments/actions.ts`'s real server-side enforcement, plus 3
 * Server Components hiding the UI option) with no shared source -- a future
 * change to this flag's logic risked updating the enforcement point while
 * missing a UI-hide call site. Single exported source of truth now.
 */
export function isMobileMoneyInitiationEnabled(): boolean {
  return process.env.TARAMONEY_INITIATION_ENABLED?.trim().toLowerCase() !== "false";
}

/**
 * Story 4.13 (AC #3): a *second* gate layered on top of the platform kill
 * switch above -- both must pass for the `mobile_money` option to show.
 * `getGymPaymentConnectionStatus`'s underlying RPC already resolves the
 * caller's own gym from their session (`private.gym_id()`, never a
 * client-supplied id), so this helper takes no gym-id parameter -- passing
 * one in would be misleading, since it's never actually used for scoping.
 *
 * Combines both checks in one exported helper, updated at all 4 of Story
 * 4.12's call sites, so this story doesn't repeat that story's own code
 * review finding ("the same boolean check duplicated across 4 call sites
 * with no shared helper", which is why `isMobileMoneyInitiationEnabled()`
 * exists as a single source of truth in the first place).
 */
export type MobileMoneyAvailability =
  | { available: true }
  | { available: false; reason: "disabled" }
  | { available: false; reason: "not_connected" }
  | { available: false; reason: "error"; error: AppError };

/**
 * Review finding (Story 4.13): the two checks above were being run inline
 * at `initiatePaymentAction` (`payments/actions.ts`) instead of through
 * `canOfferMobileMoneyPayment()`, reintroducing the duplicated-check pattern
 * this file already exists to prevent -- and along the way, a real RPC/
 * backend failure from `getGymPaymentConnectionStatus` was silently treated
 * the same as "not connected" (`data` is `null` in both cases), surfacing a
 * misleading "connect Tara Money in Settings" message for what was actually
 * a transient error. This helper is the single source of truth both
 * `canOfferMobileMoneyPayment()` (a plain boolean, for the 3 UI-visibility
 * call sites) and `initiatePaymentAction` (which needs the 3 distinct
 * reasons for its 3 distinct error messages) now share.
 */
export async function getMobileMoneyAvailability(): Promise<MobileMoneyAvailability> {
  if (!isMobileMoneyInitiationEnabled()) {
    return { available: false, reason: "disabled" };
  }
  const { data, error } = await getGymPaymentConnectionStatus(TARAMONEY_PROVIDER_KEY);
  if (error) {
    return { available: false, reason: "error", error };
  }
  if (!data) {
    return { available: false, reason: "not_connected" };
  }
  return { available: true };
}

export async function canOfferMobileMoneyPayment(): Promise<boolean> {
  const availability = await getMobileMoneyAvailability();
  return availability.available;
}

/**
 * Story 11.3: the reversibility kill switch for the saas-billing-reminders
 * Vercel Cron job -- decided with the user before merging (this story's own
 * Task 7 flag). Every existing gym was backfilled to a 3-month runway in
 * Story 11.2, so once this ships, real Owners of already-past-due gyms
 * start receiving real automated SMS/WhatsApp billing texts on the job's
 * own schedule with no other gate in front of it. Same env-var shape as
 * `isMobileMoneyInitiationEnabled()` above -- default enabled (`true`)
 * unless explicitly set to `"false"` (case/whitespace-insensitive).
 */
export function isSaasBillingRemindersEnabled(): boolean {
  return process.env.SAAS_BILLING_REMINDERS_ENABLED?.trim().toLowerCase() !== "false";
}
