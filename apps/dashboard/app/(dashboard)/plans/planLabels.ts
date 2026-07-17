import type { PlanRow } from "@/services/plans";

type PlanType = PlanRow["planType"];

// Single source of truth for the two plan-type-keyed label maps -- were
// previously duplicated verbatim in PlanModal.tsx and PlansPageClient.tsx
// (Review finding: a new plan type only needed updating in one place to
// silently break the other).
export const PLAN_TYPE_LABEL_KEY: Record<PlanType, string> = {
  pay_per_session: "plans.types.payPerSession",
  monthly: "plans.types.monthly",
  coach_inclusive: "plans.types.coachInclusive",
  class_only: "plans.types.classOnly",
};

// Read-only access-scope description surfaced under the Plan Type select --
// this is how AC #1's "access type" is exposed in the UI, sourced verbatim
// from the PRD's own Plan Type table (prd.md#6.6). Not a stored field --
// see this story's Scope Note for the full rationale.
export const ACCESS_DESCRIPTION_KEY: Record<PlanType, string> = {
  pay_per_session: "plans.accessDescriptions.payPerSession",
  monthly: "plans.accessDescriptions.monthly",
  coach_inclusive: "plans.accessDescriptions.coachInclusive",
  class_only: "plans.accessDescriptions.classOnly",
};
