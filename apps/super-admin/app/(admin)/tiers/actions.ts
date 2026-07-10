"use server";

import { tierSchema, type AppError } from "@gymos/types";
import {
  deleteTier as deleteTierRow,
  getTier,
  gymCountForTier,
  insertTier,
  listTiersWithGymCounts,
  logTierChange,
  tierCapOrderingError,
  tierNameExists,
  updateTier,
} from "@/services/tiers";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getServerTranslation } from "@/lib/i18n/get-server-translation";

/** SA-06 Create Tier. `{ data, error }` contract, never throws for expected
 * errors -- matches `createGym`'s established Process Pattern. */
export async function createTier(
  input: unknown,
): Promise<{ data: { id: string } | null; error: AppError | null }> {
  const { t } = await getServerTranslation(await getRequestLocale());
  const parsed = tierSchema.safeParse(input);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    return {
      data: null,
      error: { code: "validation_error", message: firstIssue?.message ?? t("common.invalidInput") },
    };
  }
  const tier = parsed.data;

  if (await tierNameExists(tier.name)) {
    return {
      data: null,
      error: { code: "tier_name_taken", message: t("errors.tierNameTaken") },
    };
  }

  const { data: existingTiers, error: listError } = await listTiersWithGymCounts();
  if (listError) {
    return { data: null, error: listError };
  }
  const orderingError = tierCapOrderingError(existingTiers ?? [], {
    monthlyPrice: tier.monthlyPrice,
    memberCap: tier.memberCap ?? null,
  });
  if (orderingError) {
    return { data: null, error: { code: "tier_cap_order_invalid", message: t(orderingError) } };
  }

  const { data, error } = await insertTier({
    name: tier.name,
    memberCap: tier.memberCap ?? null,
    monthlyPrice: tier.monthlyPrice,
    annualPrice: tier.annualPrice,
  });
  if (error || !data) {
    return { data: null, error };
  }

  const { error: auditError } = await logTierChange("tier_created", data.id, {
    name: tier.name,
    member_cap: tier.memberCap ?? null,
    monthly_price: tier.monthlyPrice,
    annual_price: tier.annualPrice,
  });
  if (auditError) {
    return {
      data,
      error: {
        code: "audit_log_failed",
        message: t("tiers.errors.auditLogFailedCreate"),
      },
    };
  }

  return { data, error: null };
}

/** SA-06 Edit Tier. AC #1: takes effect immediately for new gym assignments
 * only -- existing gyms keep their current tier_id, untouched by this
 * update (a name/price/cap edit never reassigns any gym). */
export async function editTier(
  tierId: string,
  input: unknown,
): Promise<{ data: { id: string } | null; error: AppError | null }> {
  const { t } = await getServerTranslation(await getRequestLocale());
  const parsed = tierSchema.safeParse(input);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    return {
      data: null,
      error: { code: "validation_error", message: firstIssue?.message ?? t("common.invalidInput") },
    };
  }
  const tier = parsed.data;

  if (await tierNameExists(tier.name, tierId)) {
    return {
      data: null,
      error: { code: "tier_name_taken", message: t("errors.tierNameTaken") },
    };
  }

  const { data: existingTiers, error: listError } = await listTiersWithGymCounts();
  if (listError) {
    return { data: null, error: listError };
  }
  const orderingError = tierCapOrderingError(existingTiers ?? [], {
    id: tierId,
    monthlyPrice: tier.monthlyPrice,
    memberCap: tier.memberCap ?? null,
  });
  if (orderingError) {
    return { data: null, error: { code: "tier_cap_order_invalid", message: t(orderingError) } };
  }

  const { error } = await updateTier(tierId, {
    name: tier.name,
    memberCap: tier.memberCap ?? null,
    monthlyPrice: tier.monthlyPrice,
    annualPrice: tier.annualPrice,
  });
  if (error) {
    return { data: null, error };
  }

  const { error: auditError } = await logTierChange("tier_edited", tierId, {
    name: tier.name,
    member_cap: tier.memberCap ?? null,
    monthly_price: tier.monthlyPrice,
    annual_price: tier.annualPrice,
  });
  if (auditError) {
    return {
      data: { id: tierId },
      error: {
        code: "audit_log_failed",
        message: t("tiers.errors.auditLogFailedEdit"),
      },
    };
  }

  return { data: { id: tierId }, error: null };
}

/** AC #2: deletion is blocked with an error naming the affected gym count.
 * Pre-checks gymCountForTier *first* -- only calls the actual DELETE when
 * the count is 0; the gyms_tier_id_fkey FK constraint (default NO ACTION)
 * is the backstop for the race window between this check and the delete,
 * not the primary path. The tier's name is looked up server-side (never
 * trusted from the client) since both the error copy and the permanent
 * audit record depend on it. */
export async function deleteTier(tierId: string): Promise<{ error: AppError | null }> {
  const { t } = await getServerTranslation(await getRequestLocale());
  const { data: tier, error: tierError } = await getTier(tierId);
  if (tierError) {
    return { error: tierError };
  }
  if (!tier) {
    return { error: { code: "not_found", message: t("tiers.errors.tierNotFound") } };
  }

  const gymCount = await gymCountForTier(tierId);
  if (gymCount > 0) {
    return {
      error: {
        code: "tier_in_use",
        message: t("tiers.errors.tierInUse", { name: tier.name, count: gymCount }),
      },
    };
  }

  const { error } = await deleteTierRow(tierId);
  if (error) {
    return { error };
  }

  const { error: auditError } = await logTierChange("tier_deleted", tierId, { name: tier.name });
  if (auditError) {
    return {
      error: {
        code: "audit_log_failed",
        message: t("tiers.errors.auditLogFailedDelete"),
      },
    };
  }

  return { error: null };
}
