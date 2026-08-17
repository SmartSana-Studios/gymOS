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
