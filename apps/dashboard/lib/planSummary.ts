/**
 * Story 27.4 (FR-240, UX AD-23 "annual plan wording"): the ONE plan summary line, built once and used by the Plans list, the PlanModal
 * helper, every plan select (assign plan, the Correct plan select) and the plan name areas (the member modal, the renewal panel).
 *
 *   monthly            "25,000 XAF · 30 days"
 *   annual interval    "250,000 XAF · 365 days · Paid once"   (« 250 000 XAF · 365 jours · Payé en une fois »)
 *   Pay-per-session    "2,000 XAF / session"
 *
 * "Paid once" follows the plan's billing interval, never its length: a plan with an annual interval is paid in full once and then runs for
 * its duration; paying it in instalments is not supported (FR-240). The dashboard only: the member app, the public gym page and the Plans
 * data are unchanged. Every string is an i18n key (EN and FR); nothing is hard-coded here.
 */

export interface PlanSummarySource {
  planType: string;
  price: number;
  durationDays: number | null;
  billingInterval: string;
}

type T = (key: string, options?: Record<string, unknown>) => string;

function isComplete(plan: Partial<PlanSummarySource>): plan is PlanSummarySource {
  return typeof plan.price === "number" && typeof plan.planType === "string";
}

/** The price number as the viewer reads it: "250,000" in English, "250 000" in French. */
export function formatPlanPrice(price: number, locale?: string): string {
  return price.toLocaleString(locale);
}

/** True for a plan the member pays in full once (an annual billing interval). */
export function isPaidOncePlan(plan: Pick<PlanSummarySource, "planType" | "billingInterval">): boolean {
  return plan.planType !== "pay_per_session" && plan.billingInterval === "annual";
}

/**
 * The summary line alone. Returns null when the plan carries no price (a partial row), so a caller falls back to the plan name instead of
 * printing a half line.
 */
export function planSummaryLine(t: T, plan: Partial<PlanSummarySource>, locale?: string): string | null {
  if (!isComplete(plan)) return null;
  const price = formatPlanPrice(plan.price, locale);
  if (plan.planType === "pay_per_session") return t("plans.summary.perSession", { price });
  if (plan.durationDays === null || plan.durationDays === undefined) return null;
  return t(isPaidOncePlan(plan) ? "plans.annual.summary" : "plans.summary.monthly", { price, days: plan.durationDays });
}

/** The text of a plan select option: "{name} · {summary line}" (the name alone when the plan has no price to summarise). */
export function planOptionLabel(t: T, plan: Partial<PlanSummarySource> & { name: string }, locale?: string): string {
  const summary = planSummaryLine(t, plan, locale);
  return summary ? t("plans.summary.option", { name: plan.name, summary }) : plan.name;
}

/** The plan name area of a read-only view: "{name} ({summary line})", the name alone when there is nothing to summarise. */
export function planNameWithSummary(t: T, plan: Partial<PlanSummarySource> & { name: string }, locale?: string): string {
  const summary = planSummaryLine(t, plan, locale);
  return summary ? t("plans.summary.withName", { name: plan.name, summary }) : plan.name;
}

/**
 * The Plans list row's price part (AD-23): it keeps its "XAF {price}" prefix and shares the summary's parts.
 *   annual interval   "XAF 250,000 · 365 days · Paid once"   (the "/ annual" suffix is gone)
 *   monthly           "XAF 25,000 / monthly · 30 days"        (as shipped)
 *   Pay-per-session   "XAF 2,000 / session"                   (as shipped)
 * Returns the whole line for an annual plan, and null for the others (the list keeps its own composition for them).
 */
export function annualListLine(t: T, plan: PlanSummarySource, locale?: string): string | null {
  if (!isPaidOncePlan(plan) || plan.durationDays === null) return null;
  return t("plans.annual.listLine", { price: formatPlanPrice(plan.price, locale), days: plan.durationDays });
}
