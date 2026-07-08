import { createClient } from "@/lib/supabase/server";
import { mapSupabaseError, type AppError } from "@gymos/types";

/**
 * `mapSupabaseError` is a pure mapping utility in `packages/types` (no
 * console/logging -- that package targets ES2022 only, no DOM/Node lib, and
 * is consumed by non-Node environments too). Application code is
 * responsible for logging the original error when it maps to the generic
 * "unknown" fallback, since otherwise the original error is lost and
 * production failures become undebuggable.
 */
export function mapAndLog(rawError: unknown): AppError {
  const mapped = mapSupabaseError(rawError);
  if (mapped.code === "unknown") {
    console.error("[mapSupabaseError] unmapped error", rawError);
  }
  return mapped;
}

export interface GymListRow {
  id: string;
  name: string;
  status: string;
  createdAt: string;
  tierName: string;
  ownerName: string | null;
  ownerPhone: string | null;
}

export interface TierOption {
  id: string;
  name: string;
}

/** SA-02 Gym List: every gym, its tier, and its owner's name/phone. */
export async function listGyms(): Promise<{
  data: GymListRow[] | null;
  error: AppError | null;
}> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("gyms")
    .select(
      `id, name, status, created_at,
       tiers ( name ),
       members ( name, phone, role )`,
    )
    .order("created_at", { ascending: false });

  if (error) {
    return { data: null, error: mapAndLog(error) };
  }

  const rows: GymListRow[] = (data ?? []).map((gym) => {
    // `members` is pre-filtered by the "super_admin_read_owner_members" RLS
    // policy to role='owner' rows only, but select() still returns an array
    // under a to-many relationship -- find the owner explicitly rather than
    // assuming index 0.
    const owner = (
      gym.members as unknown as {
        name: string;
        phone: string | null;
        role: string;
      }[]
    ).find((m) => m.role === "owner");

    return {
      id: gym.id,
      name: gym.name,
      status: gym.status,
      createdAt: gym.created_at,
      tierName:
        (gym.tiers as unknown as { name: string } | null)?.name ?? "—",
      ownerName: owner?.name ?? null,
      ownerPhone: owner?.phone ?? null,
    };
  });

  return { data: rows, error: null };
}

/** Tier dropdown source for the Create Gym form (SA-04). */
export async function listTiers(): Promise<{
  data: TierOption[] | null;
  error: AppError | null;
}> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tiers")
    .select("id, name")
    .order("name");

  if (error) {
    return { data: null, error: mapAndLog(error) };
  }

  return { data, error: null };
}

/** Best-effort fast-fail pre-check; the real guarantee is the DB's
 * case-insensitive unique index (idx_gyms_name_unique). */
export async function gymNameExists(name: string): Promise<boolean> {
  const supabase = await createClient();
  // Escape ilike's wildcard characters ('%', '_') in the user-supplied name
  // -- otherwise a name like "100% Fitness" is treated as a SQL LIKE pattern
  // instead of a literal string, causing false-positive/negative matches.
  const escaped = name.replace(/[%_]/g, (char) => `\\${char}`);
  const { data } = await supabase
    .from("gyms")
    .select("id")
    .ilike("name", escaped)
    .maybeSingle();
  return data !== null;
}

export async function insertGym(input: {
  name: string;
  tierId: string;
  status: string;
}): Promise<{ data: { id: string } | null; error: AppError | null }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("gyms")
    .insert({ name: input.name, tier_id: input.tierId, status: input.status })
    .select("id")
    .single();

  if (error || !data) {
    return { data: null, error: mapAndLog(error) };
  }
  return { data, error: null };
}

/**
 * Compensating cleanup for `createGym`'s failure paths. Chains `.select()`
 * to confirm the delete actually matched a row -- without the
 * "super_admin_delete_orphaned_gyms" RLS policy (0010 migration), this would
 * previously match 0 rows silently, permanently orphaning the gym. Logs
 * (does not throw) if the delete didn't take effect, since the caller is
 * already on a failure path and has no further recovery action available.
 */
export async function deleteGym(gymId: string): Promise<void> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("gyms")
    .delete()
    .eq("id", gymId)
    .select("id");

  if (error || !data || data.length === 0) {
    console.error(
      `[deleteGym] compensating cleanup failed to remove gym ${gymId} -- orphaned row likely remains`,
      error,
    );
  }
}

export async function insertOwnerMember(input: {
  gymId: string;
  userId: string;
  name: string;
  phone: string;
}): Promise<{ error: AppError | null }> {
  const supabase = await createClient();
  // Deliberately not chained with `.select()`: Super Admin's members-SELECT
  // policy only covers role='owner' rows they can already re-derive from the
  // input, and relying on RLS-filtered read-after-write here is unnecessary
  // -- the caller already knows the row's id (generated client-side).
  const { error } = await supabase.from("members").insert({
    gym_id: input.gymId,
    user_id: input.userId,
    role: "owner",
    name: input.name,
    phone: input.phone,
  });

  if (error) {
    return { error: mapAndLog(error) };
  }
  return { error: null };
}

export async function logGymCreated(
  gymId: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("log_audit_event", {
    p_action_type: "gym_created",
    p_gym_id: gymId,
    p_target_entity_id: gymId,
    p_target_entity_type: "gym",
    p_metadata: metadata,
  });

  if (error) {
    // Doesn't throw -- gym/owner creation already succeeded and must not be
    // rolled back over an audit-log write failure -- but this must not
    // disappear silently either, undermining Story 1.4's append-only trail.
    console.error(`[logGymCreated] audit log write failed for gym ${gymId}`, error);
  }
}
