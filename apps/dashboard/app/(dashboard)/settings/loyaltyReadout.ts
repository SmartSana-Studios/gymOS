/**
 * Story 20.5 (AD-13): pure helpers behind the Loyalty program section's live
 * discount readout and its submit-time validation.
 */

export const LOYALTY_RANGES = {
  n: { min: 2, max: 50 },
  k: { min: 3, max: 24 },
  r: { min: 1, max: 30 },
} as const;

const MAX_SUBSCRIBER_LINES = 3;

/** A whole number inside `[min, max]`, or null. Plain digits only, so "" and "1e1" never parse. */
export function parseLoyaltyNumber(raw: string, min: number, max: number): number | null {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isSafeInteger(value) && value >= min && value <= max ? value : null;
}

/** Guest discount: one free session per N paid, so 1 / (N + 1) of the sessions are free. */
export function guestDiscountPercent(n: number): number {
  return Math.round(100 / (n + 1));
}

/** Subscriber discount: R free days on top of K renewals of a D-day plan. */
export function subscriberDiscountPercent(k: number, r: number, durationDays: number): number {
  return Math.round((100 * r) / (k * durationDays + r));
}

export interface LoyaltyPlanDuration {
  name: string;
  durationDays: number;
}

export interface SubscriberReadoutLine {
  durationDays: number;
  planName: string;
  percent: number;
}

/** One line per distinct duration (the first plan in list order names it), at most three. */
export function subscriberReadoutLines(
  k: number,
  r: number,
  plans: LoyaltyPlanDuration[],
): SubscriberReadoutLine[] {
  const seen = new Set<number>();
  const lines: SubscriberReadoutLine[] = [];
  for (const plan of plans) {
    if (!Number.isInteger(plan.durationDays) || plan.durationDays <= 0) continue;
    if (seen.has(plan.durationDays)) continue;
    seen.add(plan.durationDays);
    lines.push({
      durationDays: plan.durationDays,
      planName: plan.name,
      percent: subscriberDiscountPercent(k, r, plan.durationDays),
    });
    if (lines.length === MAX_SUBSCRIBER_LINES) break;
  }
  return lines;
}
