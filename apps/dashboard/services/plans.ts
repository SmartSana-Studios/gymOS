import { createClient } from "@/lib/supabase/server";
import { type AppError } from "@gymos/types";
import { mapAndLog } from "@/services/session";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getServerTranslation } from "@/lib/i18n/get-server-translation";

/** Shared by every "0 rows affected" (RLS-denied) / "no gym_id claim" branch
 * in this file -- same discipline as gym-settings.ts's gymNotFoundError:
 * `context` is logged server-side only, never shown to the caller. */
async function planNotFoundError(context: string): Promise<AppError> {
  console.warn(`[plans] resolved to not_found: ${context}`);
  const { t } = await getServerTranslation(await getRequestLocale());
  return { code: "not_found", message: t("plans.errors.planNotFound") };
}

/** Every function in this file needs the caller's own `gym_id`, read from
 * claims -- copied verbatim from gym-settings.ts's own (unexported) helper
 * rather than reaching across service files. Resolved internally by every
 * exported function below, never accepted as a parameter from the Server
 * Action layer -- matches gym-settings.ts's own established discipline in
 * this app (apps/super-admin's tiers.ts takes an explicit gymId only
 * because tiers are platform-wide, not gym-scoped -- doesn't apply here). */
async function getCallerGymId(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<{ gymId: string | null; error: AppError | null }> {
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();

  if (claimsError) {
    return { gymId: null, error: await mapAndLog(claimsError) };
  }

  const gymId = (claimsData?.claims as { gym_id?: string } | undefined)?.gym_id;
  if (!gymId) {
    return { gymId: null, error: await planNotFoundError("no gym_id claim on caller's session") };
  }

  return { gymId, error: null };
}

export interface PlanRow {
  id: string;
  name: string;
  planType: "pay_per_session" | "monthly" | "coach_inclusive" | "class_only";
  price: number;
  currency: string;
  durationDays: number | null;
  billingInterval: "monthly" | "annual";
  annualDiscountPercent: number | null;
}

function toPlanRow(row: {
  id: string;
  name: string;
  plan_type: PlanRow["planType"];
  price: number;
  currency: string;
  duration_days: number | null;
  billing_interval: PlanRow["billingInterval"];
  annual_discount_percent: number | null;
}): PlanRow {
  return {
    id: row.id,
    name: row.name,
    planType: row.plan_type,
    price: row.price,
    currency: row.currency,
    durationDays: row.duration_days,
    billingInterval: row.billing_interval,
    annualDiscountPercent: row.annual_discount_percent,
  };
}

/** Ordered by created_at ascending -- first-configured plan shown first,
 * matches listTiersWithGymCounts' own stable-ordering discipline. */
export async function listPlans(): Promise<{ data: PlanRow[] | null; error: AppError | null }> {
  const supabase = await createClient();
  const { gymId, error: gymIdError } = await getCallerGymId(supabase);
  if (gymIdError || !gymId) {
    return { data: null, error: gymIdError };
  }

  const { data, error } = await supabase
    .from("plans")
    .select("id, name, plan_type, price, currency, duration_days, billing_interval, annual_discount_percent")
    .eq("gym_id", gymId)
    .order("created_at", { ascending: true });

  if (error) {
    return { data: null, error: await mapAndLog(error) };
  }

  return { data: (data ?? []).map(toPlanRow), error: null };
}

/** Best-effort fast-fail pre-check; the real guarantee would need a unique
 * index (none exists -- plan names only need to be unique *within* a gym,
 * unlike tierNameExists' platform-wide check, so this is scoped to the
 * caller's own gym in addition to the name match). `excludePlanId` lets an
 * edit-in-place keep its own name without colliding with itself. */
export async function planNameExists(name: string, excludePlanId?: string): Promise<boolean> {
  const supabase = await createClient();
  const { gymId } = await getCallerGymId(supabase);
  if (!gymId) return false;

  // Escape ilike's wildcard characters ('%', '_') and the escape character
  // itself ('\') -- matches tierNameExists' exact escaping.
  const escaped = name.replace(/[\\%_]/g, (char) => `\\${char}`);
  let query = supabase.from("plans").select("id").eq("gym_id", gymId).ilike("name", escaped);
  if (excludePlanId) {
    query = query.neq("id", excludePlanId);
  }
  const { data } = await query.maybeSingle();
  return data !== null;
}

/** Server-side lookup of a plan's own name -- used by deletePlan so the
 * permanent audit record never trusts a client-supplied name (which could
 * be stale/wrong by the time the Server Action runs). Scoped to the
 * caller's own gym -- a planId from a different gym resolves to "not
 * found," never leaking another gym's plan name. */
export async function getPlan(
  planId: string,
): Promise<{ data: { name: string } | null; error: AppError | null }> {
  const supabase = await createClient();
  const { gymId, error: gymIdError } = await getCallerGymId(supabase);
  if (gymIdError || !gymId) {
    return { data: null, error: gymIdError };
  }

  const { data, error } = await supabase
    .from("plans")
    .select("name")
    .eq("gym_id", gymId)
    .eq("id", planId)
    .maybeSingle();

  if (error) {
    return { data: null, error: await mapAndLog(error) };
  }
  return { data, error: null };
}

export async function insertPlan(input: {
  name: string;
  planType: PlanRow["planType"];
  price: number;
  durationDays: number | null;
  billingInterval: PlanRow["billingInterval"];
  annualDiscountPercent: number | null;
}): Promise<{ data: { id: string } | null; error: AppError | null }> {
  const supabase = await createClient();
  const { gymId, error: gymIdError } = await getCallerGymId(supabase);
  if (gymIdError || !gymId) {
    return { data: null, error: gymIdError };
  }

  const { data, error } = await supabase
    .from("plans")
    .insert({
      gym_id: gymId,
      name: input.name,
      plan_type: input.planType,
      price: input.price,
      duration_days: input.durationDays,
      billing_interval: input.billingInterval,
      annual_discount_percent: input.annualDiscountPercent,
    })
    .select("id")
    .single();

  if (error || !data) {
    return { data: null, error: await mapAndLog(error) };
  }
  return { data, error: null };
}

export async function updatePlan(
  planId: string,
  input: {
    name: string;
    planType: PlanRow["planType"];
    price: number;
    durationDays: number | null;
    billingInterval: PlanRow["billingInterval"];
    annualDiscountPercent: number | null;
  },
): Promise<{ error: AppError | null }> {
  const supabase = await createClient();
  const { gymId, error: gymIdError } = await getCallerGymId(supabase);
  if (gymIdError || !gymId) {
    return { error: gymIdError };
  }

  // Chains .select().maybeSingle() to confirm the update actually matched a
  // row -- a non-manager/owner session's UPDATE (RLS-denied) or a stale/
  // cross-gym planId would otherwise report a plain success despite
  // touching nothing (same pattern as updateTier/updateGymSettings).
  const { data, error } = await supabase
    .from("plans")
    .update({
      name: input.name,
      plan_type: input.planType,
      price: input.price,
      duration_days: input.durationDays,
      billing_interval: input.billingInterval,
      annual_discount_percent: input.annualDiscountPercent,
    })
    .eq("gym_id", gymId)
    .eq("id", planId)
    .select("id")
    .maybeSingle();

  if (error) {
    return { error: await mapAndLog(error) };
  }
  if (!data) {
    return { error: await planNotFoundError("0 rows affected by plan UPDATE (non-manager/owner session or stale/cross-gym id)") };
  }
  return { error: null };
}

/** Delete guard's data source: subscriptions referencing this plan. The
 * `subscriptions.plan_id` FK (`references plans(id)`, default NO ACTION) is
 * the backstop for the race window between this check and the actual
 * delete, not the primary guard -- mirrors gymCountForTier exactly.
 * Resolves the caller's own gym_id and re-confirms the plan belongs to it
 * (Review finding: this used to trust an already-validated planId from its
 * one caller with no defensive scoping of its own) and surfaces a genuine
 * query error instead of silently defaulting to 0 -- both for this ownership
 * check itself (Review Round 2: a failed lookup here used to fall through to
 * "plan not found" instead of a real error) and for the subscriptions count
 * query below (Review Round 1: a failed count query previously let
 * deletePlan proceed as if 0 subscriptions existed). */
export async function subscriptionCountForPlan(
  planId: string,
): Promise<{ count: number; error: AppError | null }> {
  const supabase = await createClient();
  const { gymId, error: gymIdError } = await getCallerGymId(supabase);
  if (gymIdError || !gymId) {
    return { count: 0, error: gymIdError };
  }

  const { data: plan, error: planError } = await supabase
    .from("plans")
    .select("id")
    .eq("gym_id", gymId)
    .eq("id", planId)
    .maybeSingle();
  if (planError) {
    return { count: 0, error: await mapAndLog(planError) };
  }
  if (!plan) {
    return { count: 0, error: await planNotFoundError("plan not found for caller's gym in subscriptionCountForPlan") };
  }

  const { count, error } = await supabase
    .from("subscriptions")
    .select("id", { count: "exact", head: true })
    .eq("plan_id", planId);

  if (error) {
    return { count: 0, error: await mapAndLog(error) };
  }
  return { count: count ?? 0, error: null };
}

/** Only called once the caller's own pre-check (subscriptionCountForPlan)
 * confirms 0 subscriptions reference this plan. */
export async function deletePlan(planId: string): Promise<{ error: AppError | null }> {
  const supabase = await createClient();
  const { gymId, error: gymIdError } = await getCallerGymId(supabase);
  if (gymIdError || !gymId) {
    return { error: gymIdError };
  }

  const { data, error } = await supabase
    .from("plans")
    .delete()
    .eq("gym_id", gymId)
    .eq("id", planId)
    .select("id")
    .maybeSingle();

  if (error) {
    return { error: await mapAndLog(error) };
  }
  if (!data) {
    return { error: await planNotFoundError("0 rows affected by plan DELETE (non-manager/owner session or stale/cross-gym id)") };
  }
  return { error: null };
}

/** Thin wrapper over `log_audit_event`, following logTierChange's pattern:
 * same `{error}`-only return shape, same "audit write failed" console.error
 * + mapAndLog. Unlike logTierChange (tiers are platform-wide, p_gym_id:
 * null), plans are gym-scoped -- p_gym_id is always the caller's own gym,
 * resolved internally rather than trusted from a caller-supplied value. */
export async function logPlanChange(
  actionType: "plan_created" | "plan_edited" | "plan_deleted",
  planId: string,
  metadata: Record<string, unknown>,
): Promise<{ error: AppError | null }> {
  const supabase = await createClient();
  const { gymId, error: gymIdError } = await getCallerGymId(supabase);
  if (gymIdError || !gymId) {
    return { error: gymIdError };
  }

  const { error } = await supabase.rpc("log_audit_event", {
    p_action_type: actionType,
    p_gym_id: gymId,
    p_target_entity_id: planId,
    p_target_entity_type: "plan",
    p_metadata: metadata,
  });

  if (error) {
    console.error(`[logPlanChange] audit log write failed for plan ${planId}`, error);
    return { error: await mapAndLog(error) };
  }
  return { error: null };
}
