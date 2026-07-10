import { createClient } from "@/lib/supabase/server";
import { gymIdSchema, mapSupabaseError, type AppError } from "@gymos/types";

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

const GYM_LIST_PAGE_SIZE = 20;

export interface ListGymsParams {
  page?: number; // 1-indexed
  search?: string;
  status?: "active" | "suspended" | "deactivated";
}

export interface GymListPage {
  rows: GymListRow[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * SA-02 Gym List: every gym, its tier, and its owner's name/phone, with
 * search/status filter/pagination (Story 1.5's own code review flagged
 * pagination as a deferred gap, explicitly assigned to this story).
 * `pageSize` (20) is a query default independent of the loading skeleton's
 * 5-row display convention -- those are separate concerns.
 */
export async function listGyms(
  params: ListGymsParams = {},
): Promise<{
  data: GymListPage | null;
  error: AppError | null;
}> {
  const supabase = await createClient();
  const page =
    params.page && Number.isInteger(params.page) && params.page > 0 ? params.page : 1;
  const from = (page - 1) * GYM_LIST_PAGE_SIZE;
  const to = from + GYM_LIST_PAGE_SIZE - 1;

  let query = supabase
    .from("gyms")
    .select(
      `id, name, status, created_at,
       tiers ( name ),
       members ( name, phone, role )`,
      { count: "exact" },
    )
    .order("created_at", { ascending: false })
    .range(from, to);

  if (params.search) {
    // Escape ilike's wildcard characters ('%', '_') and the escape
    // character itself ('\') -- otherwise a literal backslash in the
    // search term corrupts the pattern instead of matching literally.
    const escaped = params.search.replace(/[\\%_]/g, (char) => `\\${char}`);
    query = query.ilike("name", `%${escaped}%`);
  }
  if (params.status) {
    query = query.eq("status", params.status);
  }

  const { data, error, count } = await query;

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

  return {
    data: { rows, total: count ?? 0, page, pageSize: GYM_LIST_PAGE_SIZE },
    error: null,
  };
}

export interface GymDetail {
  id: string;
  name: string;
  status: string;
  createdAt: string;
  tierId: string;
  tierName: string;
  tierMemberCap: number | null;
  memberCapOverride: number | null;
  ownerName: string | null;
  ownerPhone: string | null;
  memberCount: number;
}

/**
 * SA-03 Gym Detail. The member count goes through the gym_member_count()
 * RPC (0011 migration), not a direct `SELECT count(*) FROM members` -- the
 * only members SELECT policy for Super Admin is role='owner'-scoped (Story
 * 1.5), so a direct count query would be silently filtered by RLS. The
 * RPC's SECURITY DEFINER is what makes the real count reachable without
 * broadening that policy.
 *
 * `escalated` (Story 1.7) is deliberately NOT computed here -- it used to be
 * a third `Promise.all` branch calling `auth.getUser()` (a network round
 * trip to the Auth server, unlike this app's established `getClaims()`
 * convention) plus its own `audit_log` query. That query duplicated
 * `listGymAuditTrail`'s (page.tsx already fetches the gym's full audit
 * trail separately), swallowed its own error indistinguishably from "not
 * escalated", and an unguarded `getUser()` throw could reject this whole
 * `Promise.all`. The caller now derives `escalated` from the already-fetched
 * audit trail instead (see `gyms/[id]/page.tsx`).
 */
export async function getGymDetail(gymId: string): Promise<{
  data: GymDetail | null;
  error: AppError | null;
}> {
  if (!gymIdSchema.safeParse(gymId).success) {
    return { data: null, error: null };
  }

  const supabase = await createClient();

  const [{ data: gym, error: gymError }, { data: memberCount, error: countError }] =
    await Promise.all([
      supabase
        .from("gyms")
        .select(
          `id, name, status, created_at, tier_id, member_cap_override,
           tiers ( name, member_cap ),
           members ( name, phone, role )`,
        )
        .eq("id", gymId)
        .maybeSingle(),
      supabase.rpc("gym_member_count", { p_gym_id: gymId }),
    ]);

  if (gymError || countError) {
    return { data: null, error: mapAndLog(gymError ?? countError) };
  }
  if (!gym) {
    return { data: null, error: null };
  }

  const owner = (
    gym.members as unknown as { name: string; phone: string | null; role: string }[]
  ).find((m) => m.role === "owner");
  const tier = gym.tiers as unknown as { name: string; member_cap: number | null } | null;

  return {
    data: {
      id: gym.id,
      name: gym.name,
      status: gym.status,
      createdAt: gym.created_at,
      tierId: gym.tier_id,
      tierName: tier?.name ?? "—",
      tierMemberCap: tier?.member_cap ?? null,
      memberCapOverride: gym.member_cap_override,
      ownerName: owner?.name ?? null,
      ownerPhone: owner?.phone ?? null,
      memberCount: Number(memberCount ?? 0),
    },
    error: null,
  };
}

export interface AuditTrailEntry {
  id: string;
  actorId: string | null;
  actorDisplayName: string;
  actionType: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

const AUDIT_TRAIL_MAX_ROWS = 200;

/**
 * SA-03's "Audit trail" tab: this gym's audit_log history (every action
 * type, not just escalations -- Dev Notes Open Question 2), newest first,
 * capped at `AUDIT_TRAIL_MAX_ROWS`. No date-range/actor filter, unlike Epic
 * 7's fuller AD-12 page. `actorId` is selected (not just
 * `actorDisplayName`) so the caller can derive "did the current Super Admin
 * escalate to this gym" from this same result set instead of a second query.
 */
export async function listGymAuditTrail(gymId: string): Promise<{
  data: AuditTrailEntry[] | null;
  error: AppError | null;
}> {
  if (!gymIdSchema.safeParse(gymId).success) {
    return { data: null, error: null };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("audit_log")
    .select("id, actor_id, actor_display_name, action_type, metadata, created_at")
    .eq("gym_id", gymId)
    .order("created_at", { ascending: false })
    .limit(AUDIT_TRAIL_MAX_ROWS);

  if (error) {
    return { data: null, error: mapAndLog(error) };
  }

  const rows: AuditTrailEntry[] = (data ?? []).map((row) => ({
    id: row.id,
    actorId: row.actor_id,
    actorDisplayName: row.actor_display_name,
    actionType: row.action_type,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    createdAt: row.created_at,
  }));

  return { data: rows, error: null };
}

/**
 * Story 1.7 (FR-072): writes the `gym_data_escalation` audit_log row that
 * *is* the access grant (0012 migration's design note -- one event, not a
 * grant record plus a separate audit record). Thin wrapper over
 * `logGymLifecycleEvent`, which already surfaces (never swallows) an audit
 * RPC failure -- critical here, since unlike the lifecycle/tier/cap events
 * it wraps, a failed write here means no access was granted at all.
 */
export async function logGymDataEscalation(
  gymId: string,
  reason: string,
): Promise<{ error: AppError | null }> {
  return logGymLifecycleEvent("gym_data_escalation", gymId, { reason });
}

/**
 * Reads the gym's current `status` before updating so the caller can (a)
 * detect a no-op transition and (b) record `previous_status` in the audit
 * entry. Chains `.select("id").maybeSingle()` on the UPDATE itself so a
 * stale/nonexistent `gymId` (0 rows matched) surfaces as `not_found` instead
 * of a false-success.
 */
export async function updateGymStatus(
  gymId: string,
  status: "active" | "suspended" | "deactivated",
): Promise<
  { data: { previousStatus: string }; error: null } | { data: null; error: AppError }
> {
  const supabase = await createClient();

  const { data: before, error: beforeError } = await supabase
    .from("gyms")
    .select("status")
    .eq("id", gymId)
    .maybeSingle();
  if (beforeError) {
    return { data: null, error: mapAndLog(beforeError) };
  }
  if (!before) {
    return { data: null, error: { code: "not_found", message: "Gym not found" } };
  }

  const { data: updated, error } = await supabase
    .from("gyms")
    .update({ status })
    .eq("id", gymId)
    .select("id")
    .maybeSingle();
  if (error) {
    return { data: null, error: mapAndLog(error) };
  }
  if (!updated) {
    return { data: null, error: { code: "not_found", message: "Gym not found" } };
  }

  return { data: { previousStatus: before.status }, error: null };
}

/** SA-03 "Change" tier. Reassignment only affects new gym assignments --
 * existing members are never automatically reclassified (AC #1); this is
 * purely an UPDATE of gyms.tier_id, no cascading member/subscription
 * changes. Same before-read / rows-affected pattern as updateGymStatus. */
export async function updateGymTier(
  gymId: string,
  tierId: string,
): Promise<
  { data: { previousTierId: string }; error: null } | { data: null; error: AppError }
> {
  const supabase = await createClient();

  const { data: before, error: beforeError } = await supabase
    .from("gyms")
    .select("tier_id")
    .eq("id", gymId)
    .maybeSingle();
  if (beforeError) {
    return { data: null, error: mapAndLog(beforeError) };
  }
  if (!before) {
    return { data: null, error: { code: "not_found", message: "Gym not found" } };
  }

  const { data: updated, error } = await supabase
    .from("gyms")
    .update({ tier_id: tierId })
    .eq("id", gymId)
    .select("id")
    .maybeSingle();
  if (error) {
    return { data: null, error: mapAndLog(error) };
  }
  if (!updated) {
    return { data: null, error: { code: "not_found", message: "Gym not found" } };
  }

  return { data: { previousTierId: before.tier_id }, error: null };
}

/** SA-03 "Override cap". `null` clears the override, reverting to the
 * tier's own member_cap. Same before-read / rows-affected pattern as
 * updateGymStatus. */
export async function updateGymCapOverride(
  gymId: string,
  capOverride: number | null,
): Promise<
  | { data: { previousCapOverride: number | null }; error: null }
  | { data: null; error: AppError }
> {
  const supabase = await createClient();

  const { data: before, error: beforeError } = await supabase
    .from("gyms")
    .select("member_cap_override")
    .eq("id", gymId)
    .maybeSingle();
  if (beforeError) {
    return { data: null, error: mapAndLog(beforeError) };
  }
  if (!before) {
    return { data: null, error: { code: "not_found", message: "Gym not found" } };
  }

  const { data: updated, error } = await supabase
    .from("gyms")
    .update({ member_cap_override: capOverride })
    .eq("id", gymId)
    .select("id")
    .maybeSingle();
  if (error) {
    return { data: null, error: mapAndLog(error) };
  }
  if (!updated) {
    return { data: null, error: { code: "not_found", message: "Gym not found" } };
  }

  return { data: { previousCapOverride: before.member_cap_override }, error: null };
}

/** Covers every gym-lifecycle/tier/cap-override/escalation audit entry this
 * story and the prior one write -- one small helper instead of near-duplicate
 * functions per action type. Returns the RPC's own error (instead of only
 * console.error-ing it) so the caller can surface "the change saved, but the
 * audit entry failed to write" rather than silently reporting a plain
 * success -- for `gym_data_escalation` specifically, `logGymDataEscalation`'s
 * caller treats this as a real blocking error, not a benign "saved anyway"
 * outcome, since there the audit write is the only effect of the action. */
export async function logGymLifecycleEvent(
  actionType:
    | "gym_suspended"
    | "gym_deactivated"
    | "gym_reinstated"
    | "gym_tier_changed"
    | "gym_cap_overridden"
    | "gym_data_escalation",
  gymId: string,
  metadata: Record<string, unknown>,
): Promise<{ error: AppError | null }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("log_audit_event", {
    p_action_type: actionType,
    p_gym_id: gymId,
    p_target_entity_id: gymId,
    p_target_entity_type: "gym",
    p_metadata: metadata,
  });

  if (error) {
    console.error(`[logGymLifecycleEvent] audit log write failed for gym ${gymId}`, error);
    return { error: mapAndLog(error) };
  }
  return { error: null };
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
