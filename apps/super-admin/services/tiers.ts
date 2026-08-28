import { createClient } from "@/lib/supabase/server";
import { type AppError } from "@gymos/types";
import { mapAndLog } from "@/services/gyms";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getServerTranslation } from "@/lib/i18n/get-server-translation";

/** Shared by every "tier row not found" branch below (Review finding: these
 * were hardcoded English literals, invisible to both the ESLint gate and
 * AC #3). */
async function tierNotFoundError(): Promise<AppError> {
  const { t } = await getServerTranslation(await getRequestLocale());
  return { code: "not_found", message: t("tiers.errors.tierNotFound") };
}

export interface TierRow {
  id: string;
  name: string;
  memberCap: number | null;
  monthlyPrice: number;
  annualPrice: number;
  gymCount: number;
  priceLocked: boolean;
}

/**
 * SA-06 Tier Management list + the delete-guard pre-check's data source.
 * Ordered by monthly_price ascending -- the order Hustle/Grind/Elite's
 * pricing already follows, and the order the UI derives each tier's
 * display "min" range from (previous tier's cap + 1).
 */
export async function listTiersWithGymCounts(): Promise<{
  data: TierRow[] | null;
  error: AppError | null;
}> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tiers")
    .select("id, name, member_cap, monthly_price, annual_price, price_locked, gyms(count)")
    .order("monthly_price", { ascending: true });

  if (error) {
    return { data: null, error: await mapAndLog(error) };
  }

  const rows: TierRow[] = (data ?? []).map((tier) => ({
    id: tier.id,
    name: tier.name,
    memberCap: tier.member_cap,
    monthlyPrice: tier.monthly_price,
    annualPrice: tier.annual_price,
    priceLocked: tier.price_locked,
    gymCount:
      (tier.gyms as unknown as { count: number }[] | null)?.[0]?.count ?? 0,
  }));

  return { data: rows, error: null };
}

/** Best-effort fast-fail pre-check; the real guarantee is the DB's
 * case-insensitive unique index (idx_tiers_name_unique). `excludeTierId`
 * lets an edit-in-place keep its own name without colliding with itself. */
export async function tierNameExists(
  name: string,
  excludeTierId?: string,
): Promise<boolean> {
  const supabase = await createClient();
  // Escape ilike's wildcard characters ('%', '_') and the escape character
  // itself ('\') -- otherwise a literal backslash in the name corrupts the
  // pattern instead of matching literally.
  const escaped = name.replace(/[\\%_]/g, (char) => `\\${char}`);
  let query = supabase.from("tiers").select("id").ilike("name", escaped);
  if (excludeTierId) {
    query = query.neq("id", excludeTierId);
  }
  const { data } = await query.maybeSingle();
  return data !== null;
}

/** Server-side lookup of a tier's own name -- used by deleteTier so the
 * permanent audit record and the user-facing error copy never trust a
 * client-supplied name string (which could be stale/wrong by the time the
 * Server Action runs). */
export async function getTier(
  tierId: string,
): Promise<{ data: { name: string } | null; error: AppError | null }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tiers")
    .select("name")
    .eq("id", tierId)
    .maybeSingle();

  if (error) {
    return { data: null, error: await mapAndLog(error) };
  }
  return { data, error: null };
}

/** AC #2's delete guard: count of gyms currently assigned to this tier. */
export async function gymCountForTier(tierId: string): Promise<number> {
  const supabase = await createClient();
  const { count } = await supabase
    .from("gyms")
    .select("id", { count: "exact", head: true })
    .eq("tier_id", tierId);
  return count ?? 0;
}

export async function insertTier(input: {
  name: string;
  memberCap: number | null;
  monthlyPrice: number;
  annualPrice: number;
}): Promise<{ data: { id: string } | null; error: AppError | null }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tiers")
    .insert({
      name: input.name,
      member_cap: input.memberCap,
      monthly_price: input.monthlyPrice,
      annual_price: input.annualPrice,
    })
    .select("id")
    .single();

  if (error || !data) {
    return { data: null, error: await mapAndLog(error) };
  }
  return { data, error: null };
}

export async function updateTier(
  tierId: string,
  input: {
    name: string;
    memberCap: number | null;
    monthlyPrice: number;
    annualPrice: number;
  },
): Promise<{ error: AppError | null }> {
  const supabase = await createClient();
  // Chains .select().maybeSingle() to confirm the update actually matched a
  // row -- a stale/nonexistent tierId would otherwise return a plain
  // success despite touching nothing.
  const { data, error } = await supabase
    .from("tiers")
    .update({
      name: input.name,
      member_cap: input.memberCap,
      monthly_price: input.monthlyPrice,
      annual_price: input.annualPrice,
    })
    .eq("id", tierId)
    .select("id")
    .maybeSingle();

  if (error) {
    return { error: await mapAndLog(error) };
  }
  if (!data) {
    return { error: await tierNotFoundError() };
  }
  return { error: null };
}

/** Only called once the AC #2 pre-check (gymCountForTier) confirms 0 gyms
 * use this tier -- the gyms_tier_id_fkey constraint (default NO ACTION) is
 * the backstop for the race window between that check and this delete, not
 * the primary guard. */
export async function deleteTier(tierId: string): Promise<{ error: AppError | null }> {
  const supabase = await createClient();
  // Chains .select().maybeSingle() to confirm the delete actually matched a
  // row -- a tier deleted concurrently between deleteTier's own pre-checks
  // and this call would otherwise report a false success and still log a
  // tier_deleted audit entry for a delete that didn't happen.
  const { data, error } = await supabase
    .from("tiers")
    .delete()
    .eq("id", tierId)
    .select("id")
    .maybeSingle();

  if (error) {
    return { error: await mapAndLog(error) };
  }
  if (!data) {
    return { error: await tierNotFoundError() };
  }
  return { error: null };
}

/**
 * TiersPageClient's derived min/max range display (rangeLabel) assumes
 * member_cap increases monotonically alongside monthly_price across tiers.
 * Nothing in the schema enforces that, so createTier/editTier validate a
 * candidate (price, cap) pair against its neighbors -- once sorted by
 * price, a cheaper tier must not have a higher cap than this one, and a
 * pricier tier must not have a lower one (null = unlimited, always
 * permitted at the top end).
 *
 * Returns a locale key, not localized text (Review finding: this is a pure
 * sync function called directly from tiers/actions.ts's request-handling
 * code, which already resolves `t` -- keeps this function itself free of
 * any i18n dependency rather than threading `t` through it).
 */
export function tierCapOrderingError(
  existingTiers: { id: string; monthlyPrice: number; memberCap: number | null }[],
  candidate: { id?: string; monthlyPrice: number; memberCap: number | null },
): string | null {
  const others = existingTiers.filter((t) => t.id !== candidate.id);
  const sorted = [...others, candidate].sort((a, b) => a.monthlyPrice - b.monthlyPrice);
  const index = sorted.indexOf(candidate);
  const prev = sorted[index - 1];
  const next = sorted[index + 1];

  // A tie on monthlyPrice doesn't establish a "cheaper"/"pricier" relationship
  // -- Array.sort's stability plus the candidate always being concatenated
  // last would otherwise arbitrarily treat a same-priced neighbor as
  // strictly cheaper (or pricier), rejecting valid equal-price configurations.
  if (prev && prev.monthlyPrice !== candidate.monthlyPrice) {
    const violatesPrev =
      prev.memberCap === null
        ? candidate.memberCap !== null
        : candidate.memberCap !== null && candidate.memberCap < prev.memberCap;
    if (violatesPrev) {
      return "tiers.errors.capOrderingViolatesPrev";
    }
  }

  if (next && next.monthlyPrice !== candidate.monthlyPrice) {
    const violatesNext =
      candidate.memberCap === null
        ? next.memberCap !== null
        : next.memberCap !== null && candidate.memberCap > next.memberCap;
    if (violatesNext) {
      return "tiers.errors.capOrderingViolatesNext";
    }
  }

  return null;
}

/** Tiers are platform-wide, not gym-owned (architecture.md Entity
 * Relationships) -- p_gym_id is always null for tier audit records. Returns
 * the RPC's own error (instead of only console.error-ing it) so the caller
 * can surface "the change saved, but the audit entry failed to write"
 * rather than silently reporting a plain success -- same pattern as
 * logGymLifecycleEvent. */
export async function logTierChange(
  actionType: "tier_created" | "tier_edited" | "tier_deleted",
  tierId: string,
  metadata: Record<string, unknown>,
): Promise<{ error: AppError | null }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("log_audit_event", {
    p_action_type: actionType,
    p_target_entity_id: tierId,
    p_target_entity_type: "tier",
    p_metadata: metadata,
  });

  if (error) {
    console.error(`[logTierChange] audit log write failed for tier ${tierId}`, error);
    return { error: await mapAndLog(error) };
  }
  return { error: null };
}
