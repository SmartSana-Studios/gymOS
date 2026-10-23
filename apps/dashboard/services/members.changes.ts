import { createClient } from "@/lib/supabase/server";
import { type AppError } from "@gymos/types";
import { mapAndLog } from "@/services/session";
import { getCallerGymId, memberNotFoundError } from "./members.shared";

// Member edits and deactivation, plus the audit helper they share (split out of members.ts, Epic 20 retro G-2).
// members.ts re-exports the public names.

export interface UpdateMemberInput {
  name: string;
  email: string | null;
  dob: string | null;
  photoUrl: string | null;
  emergencyContact: string | null;
  birthYear: number | null;
  profession: string | null;
  neighborhood: string | null;
}

/** Edit-mode fields only (Scope Note's Edit-mode boundary) -- no phone,
 * plan, join date, subscription status, or expiry date. Chains
 * `.select().maybeSingle()` to confirm the update actually matched a row --
 * a non-manager/owner session's UPDATE (RLS-denied) or a stale/cross-gym
 * memberId would otherwise report a plain success despite touching nothing
 * (same pattern as `updatePlan`/`updateGymSettings`). */
export async function updateMember(
  memberId: string,
  input: UpdateMemberInput,
): Promise<{ error: AppError | null }> {
  const supabase = await createClient();
  const { gymId, error: gymIdError } = await getCallerGymId(supabase);
  if (gymIdError || !gymId) {
    return { error: gymIdError };
  }

  const { data, error } = await supabase
    .from("members")
    .update({
      name: input.name,
      email: input.email,
      dob: input.dob,
      photo_url: input.photoUrl,
      emergency_contact: input.emergencyContact,
      birth_year: input.birthYear,
      profession: input.profession,
      neighborhood: input.neighborhood,
    })
    .eq("gym_id", gymId)
    .eq("id", memberId)
    .select("id")
    .maybeSingle();

  if (error) {
    return { error: await mapAndLog(error) };
  }
  if (!data) {
    return { error: await memberNotFoundError("0 rows affected by member UPDATE (non-manager/owner session or stale/cross-gym id)") };
  }
  return { error: null };
}

/** AC #3: sets `members.deactivated_at = now()` AND the member's current
 * `subscriptions.status = 'expired'` -- two updates (no single-statement
 * multi-table update via supabase-js). Reason is not stored on either row
 * -- it lives in the audit_log metadata only (matches `changeGymStatus`'s
 * established pattern), written by `logMemberChange`'s caller. */
export async function deactivateMember(memberId: string): Promise<{ error: AppError | null }> {
  const supabase = await createClient();
  const { gymId, error: gymIdError } = await getCallerGymId(supabase);
  if (gymIdError || !gymId) {
    return { error: gymIdError };
  }

  const { data: memberRow, error: memberError } = await supabase
    .from("members")
    .update({ deactivated_at: new Date().toISOString() })
    .eq("gym_id", gymId)
    .eq("id", memberId)
    .select("id")
    .maybeSingle();

  if (memberError) {
    return { error: await mapAndLog(memberError) };
  }
  if (!memberRow) {
    return { error: await memberNotFoundError("0 rows affected by member deactivation UPDATE (non-manager/owner session or stale/cross-gym id)") };
  }

  // Compensating rollback shared by both failure points below: no
  // cross-table transaction available via supabase-js (same accepted
  // limitation as `deleteMemberForCleanup` above), so undo the
  // already-committed `deactivated_at` rather than leave the member marked
  // deactivated with a still-active subscription.
  async function rollbackDeactivation(cause: unknown): Promise<{ error: AppError | null }> {
    const { error: rollbackError } = await supabase
      .from("members")
      .update({ deactivated_at: null })
      .eq("gym_id", gymId)
      .eq("id", memberId);
    if (rollbackError) {
      console.error(
        `[members] deactivateMember rollback failed to restore member ${memberId} after a failed subscription lookup/UPDATE`,
        rollbackError,
      );
    }
    return { error: await mapAndLog(cause) };
  }

  // Story 3.2: a member can now have multiple `subscriptions` rows (renewal
  // history) -- only the current (most-recently-created) one should be
  // expired here, not every historical row, or deactivation would silently
  // rewrite a prior row's already-accurate historical status (e.g. a
  // `grace_period` row from before a renewal getting retroactively flipped
  // to `expired`). Mirrors the same "most recent subscription"
  // `.order(...).limit(1)` pattern already used by this file's own read
  // queries (~lines 219-220, 756-757). A member with zero subscription rows
  // (shouldn't happen in practice -- every member gets exactly one at
  // creation) is tolerated as a no-op, matching the original blanket
  // UPDATE's own implicit "0 rows matched" tolerance.
  const { data: currentSubscription, error: currentSubscriptionError } = await supabase
    .from("subscriptions")
    .select("id")
    .eq("gym_id", gymId)
    .eq("member_id", memberId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (currentSubscriptionError) {
    return rollbackDeactivation(currentSubscriptionError);
  }

  if (currentSubscription) {
    const { error: subscriptionError } = await supabase
      .from("subscriptions")
      .update({ status: "expired" })
      .eq("gym_id", gymId)
      .eq("id", currentSubscription.id);

    if (subscriptionError) {
      return rollbackDeactivation(subscriptionError);
    }
  }

  return { error: null };
}

/** Thin `log_audit_event` wrapper, following `logPlanChange`'s pattern:
 * same `{error}`-only return shape, same "audit write failed" console.error
 * + mapAndLog, same internally-resolved gym_id discipline. */
export async function logMemberChange(
  actionType: "member_created" | "member_edited" | "member_deactivated" | "member_plan_assigned",
  memberId: string,
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
    p_target_entity_id: memberId,
    p_target_entity_type: "member",
    p_metadata: metadata,
  });

  if (error) {
    console.error(`[logMemberChange] audit log write failed for member ${memberId}`, error);
    return { error: await mapAndLog(error) };
  }
  return { error: null };
}

// ============================================================================
// Story 18.6: the registration-fee line in the read-only member detail, and
// the void dialog's read of the fee payment. Read on demand for ONE member --
// the list never fetches fee state per row.
// ============================================================================
