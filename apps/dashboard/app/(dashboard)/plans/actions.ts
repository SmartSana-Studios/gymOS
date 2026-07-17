"use server";

import { planSchema, type AppError } from "@gymos/types";
import {
  deletePlan as deletePlanRow,
  getPlan,
  insertPlan,
  logPlanChange,
  planNameExists,
  subscriptionCountForPlan,
  updatePlan,
} from "@/services/plans";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getServerTranslation } from "@/lib/i18n/get-server-translation";

/** Membership Plan Create. `{ data, error }` never-throws contract, matches
 * createTier's established Process Pattern. No gymId argument -- every plan
 * action here is implicitly scoped to the caller's own gym via
 * getCallerGymId() inside the service layer, never a client-supplied gym id
 * (apps/super-admin's tier actions take an explicit gymId only because
 * tiers are platform-wide; doesn't apply here). */
export async function createPlan(
  input: unknown,
): Promise<{ data: { id: string } | null; error: AppError | null }> {
  const { t } = await getServerTranslation(await getRequestLocale());
  const parsed = planSchema.safeParse(input);
  if (!parsed.success) {
    // planSchema's own issue messages are hardcoded English literals (not
    // routed through i18n) -- surfacing them directly would show raw
    // English text to a French-locale user who bypasses PlanModal's
    // pre-Zod client-side guards (e.g. a non-integer price). Always fall
    // back to the localized generic message instead (Review finding); the
    // client's own field-level guards already cover the common cases with
    // properly translated copy before safeParse ever runs.
    return {
      data: null,
      error: { code: "validation_error", message: t("common.invalidInput") },
    };
  }
  const plan = parsed.data;

  if (await planNameExists(plan.name)) {
    return {
      data: null,
      error: { code: "plan_name_taken", message: t("plans.errors.planNameTaken") },
    };
  }

  const { data, error } = await insertPlan({
    name: plan.name,
    planType: plan.planType,
    price: plan.price,
    durationDays: plan.durationDays,
    billingInterval: plan.billingInterval,
    annualDiscountPercent: plan.annualDiscountPercent,
  });
  if (error || !data) {
    return { data: null, error };
  }

  const { error: auditError } = await logPlanChange("plan_created", data.id, {
    name: plan.name,
    plan_type: plan.planType,
    price: plan.price,
    duration_days: plan.durationDays,
    billing_interval: plan.billingInterval,
    annual_discount_percent: plan.annualDiscountPercent,
  });
  if (auditError) {
    return {
      data,
      error: {
        code: "audit_log_failed",
        message: t("plans.errors.auditLogFailedCreate"),
      },
    };
  }

  return { data, error: null };
}

/** Membership Plan Edit. */
export async function editPlan(
  planId: string,
  input: unknown,
): Promise<{ data: { id: string } | null; error: AppError | null }> {
  const { t } = await getServerTranslation(await getRequestLocale());
  const parsed = planSchema.safeParse(input);
  if (!parsed.success) {
    // planSchema's own issue messages are hardcoded English literals (not
    // routed through i18n) -- surfacing them directly would show raw
    // English text to a French-locale user who bypasses PlanModal's
    // pre-Zod client-side guards (e.g. a non-integer price). Always fall
    // back to the localized generic message instead (Review finding); the
    // client's own field-level guards already cover the common cases with
    // properly translated copy before safeParse ever runs.
    return {
      data: null,
      error: { code: "validation_error", message: t("common.invalidInput") },
    };
  }
  const plan = parsed.data;

  if (await planNameExists(plan.name, planId)) {
    return {
      data: null,
      error: { code: "plan_name_taken", message: t("plans.errors.planNameTaken") },
    };
  }

  const { error } = await updatePlan(planId, {
    name: plan.name,
    planType: plan.planType,
    price: plan.price,
    durationDays: plan.durationDays,
    billingInterval: plan.billingInterval,
    annualDiscountPercent: plan.annualDiscountPercent,
  });
  if (error) {
    return { data: null, error };
  }

  const { error: auditError } = await logPlanChange("plan_edited", planId, {
    name: plan.name,
    plan_type: plan.planType,
    price: plan.price,
    duration_days: plan.durationDays,
    billing_interval: plan.billingInterval,
    annual_discount_percent: plan.annualDiscountPercent,
  });
  if (auditError) {
    return {
      data: { id: planId },
      error: {
        code: "audit_log_failed",
        message: t("plans.errors.auditLogFailedEdit"),
      },
    };
  }

  return { data: { id: planId }, error: null };
}

/** AC-adjacent guard (not a literal AC, but required for the feature to
 * work end-to-end -- a plan referenced by a real subscription can't be
 * deleted out from under it): pre-checks subscriptionCountForPlan first,
 * only calls the actual DELETE when the count is 0. The
 * subscriptions.plan_id FK (default NO ACTION) is the backstop for the race
 * window between this check and the delete, not the primary path -- same
 * discipline as deleteTier's gymCountForTier guard. The plan's name is
 * looked up server-side (never trusted from the client) since both the
 * error copy and the permanent audit record depend on it. */
export async function deletePlan(planId: string): Promise<{ error: AppError | null }> {
  const { t } = await getServerTranslation(await getRequestLocale());
  const { data: plan, error: planError } = await getPlan(planId);
  if (planError) {
    return { error: planError };
  }
  if (!plan) {
    return { error: { code: "not_found", message: t("plans.errors.planNotFound") } };
  }

  const { count: subscriptionCount, error: countError } = await subscriptionCountForPlan(planId);
  if (countError) {
    return { error: countError };
  }
  if (subscriptionCount > 0) {
    return {
      error: {
        code: "plan_in_use",
        message: t("plans.errors.planInUse", { name: plan.name, count: subscriptionCount }),
      },
    };
  }

  const { error } = await deletePlanRow(planId);
  if (error) {
    return { error };
  }

  const { error: auditError } = await logPlanChange("plan_deleted", planId, { name: plan.name });
  if (auditError) {
    return {
      error: {
        code: "audit_log_failed",
        message: t("plans.errors.auditLogFailedDelete"),
      },
    };
  }

  return { error: null };
}
