import { z } from "zod";

// Story 2.2: Membership Plan Configuration (FR-024/025/026).
//
// Postgres int4 upper bound -- values beyond this overflow the DB column
// (matches tier.ts's own local MAX_INT4 -- kept per-file, not shared, per
// that file's own established convention).
const MAX_INT4 = 2147483647;

export const planTypeSchema = z.enum([
  "pay_per_session",
  "monthly",
  "coach_inclusive",
  "class_only",
]);

export const billingIntervalSchema = z.enum(["monthly", "annual"]);

// "Access type" (FR-025) is deliberately not a separate field here --
// `planType` is the access-type discriminator (see this story's Scope
// Note). `currency` isn't a field either -- always 'XAF' in V1, relies on
// the `plans.currency` column's own DB default (gym-settings.ts's precedent
// for "no UI surface for a V1-fixed value").
export const planSchema = z
  .object({
    name: z.string().trim().min(1, "Plan name is required"),
    planType: planTypeSchema,
    price: z
      .number()
      .int()
      .nonnegative("Enter a valid price in XAF")
      .max(MAX_INT4, "Value is too large"),
    // null only valid for pay_per_session ("no fixed expiry" per the PRD's
    // Plan Type table) -- every other plan type requires a positive integer
    // number of days.
    durationDays: z
      .number()
      .int()
      .positive("Enter a duration in days")
      .max(MAX_INT4, "Value is too large")
      .nullable(),
    billingInterval: billingIntervalSchema,
    // Only meaningful (and required) when billingInterval is "annual" --
    // stored independently of tier/price fields (AC #2).
    annualDiscountPercent: z
      .number()
      .int()
      .min(0, "Enter a discount between 0 and 100")
      .max(100, "Enter a discount between 0 and 100")
      .nullable(),
  })
  .refine(
    (data) =>
      data.planType === "pay_per_session"
        ? data.durationDays === null
        : data.durationDays !== null,
    {
      message:
        "Duration is required for every plan type except Pay-per-session, which has no fixed duration",
      path: ["durationDays"],
    },
  )
  .refine(
    (data) =>
      data.billingInterval === "annual"
        ? data.annualDiscountPercent !== null
        : data.annualDiscountPercent === null,
    {
      message: "Annual discount is required for an annual billing interval, and must be empty otherwise",
      path: ["annualDiscountPercent"],
    },
  )
  // Pay-per-session has no billing cycle to speak of (Scope Note) -- the UI
  // already forces/disables billingInterval to "monthly" when planType is
  // pay_per_session (PlanModal's handlePlanTypeChange), but nothing
  // previously stopped a direct payload from pairing pay_per_session with
  // annual + a discount (Review finding).
  .refine(
    (data) => data.planType !== "pay_per_session" || data.billingInterval === "monthly",
    {
      message: "Pay-per-session plans have no billing cycle and must use a monthly billing interval",
      path: ["billingInterval"],
    },
  );

export type PlanInput = z.infer<typeof planSchema>;
