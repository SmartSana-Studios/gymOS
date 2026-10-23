import { authorizeAction } from "@/lib/authz";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { type AppError } from "@gymos/types";
import { mapAndLog } from "@/services/session";
import { type MemberListRow, type MemberRowFromDb, getCallerGymId, memberNotFoundError, toMemberListRow } from "./members.shared";

// Read-only member detail: the registration-fee state and the single list row (split out of members.ts,
// Epic 20 retro G-2). members.ts re-exports the public names.

/** Roles that can read `audit_log` through RLS (0049 + 0093). Only these see who
 * waived a fee and why. */
const AUDIT_READER_ROLES = new Set(["manager", "supervisor", "owner"]);

export type MemberRegistrationFeeState =
  | { kind: "awaiting" }
  | {
      kind: "paid";
      paymentId: string;
      amount: number;
      currency: string;
      method: string;
      paidAt: string;
    }
  | {
      kind: "waived";
      /** Null for a role that cannot read the audit log. */
      waivedByName: string | null;
      reason: string | null;
    }
  | { kind: "none" };

/**
 * Awaiting: `registration_fee_settled_at` is null. Paid: a non-voided, verified
 * `registration_fee` payment. Waived: the latest `registration_fee_waived` audit
 * row for the member. A settled member with neither (an existing member, an
 * import, or a fee-0 creation)
 * is `none` and the detail shows nothing.
 *
 * The audit row is read with the service-role client, scoped to the caller's own
 * gym from the session claims, because a receptionist cannot read `audit_log`
 * yet must still see that the fee was waived. The actor name and reason are only
 * returned to manager, supervisor and owner, the roles whose RLS grants that
 * read; nothing else from the row leaves this function.
 */
export async function getMemberRegistrationFeeState(
  memberId: string,
): Promise<{ data: MemberRegistrationFeeState | null; error: AppError | null }> {
  const supabase = await createClient();
  const { gymId, error: gymIdError } = await getCallerGymId(supabase);
  if (gymIdError || !gymId) {
    return { data: null, error: gymIdError };
  }

  const { data: member, error: memberError } = await supabase
    .from("members")
    .select("registration_fee_settled_at")
    .eq("gym_id", gymId)
    .eq("id", memberId)
    .eq("role", "member")
    .maybeSingle();
  if (memberError) {
    return { data: null, error: await mapAndLog(memberError) };
  }
  if (!member) {
    return {
      data: null,
      error: await memberNotFoundError("0 rows for the registration fee state lookup (stale/cross-gym id or non-member role)"),
    };
  }

  if (member.registration_fee_settled_at == null) {
    return { data: { kind: "awaiting" }, error: null };
  }

  const { data: payment, error: paymentError } = await supabase
    .from("payments")
    .select("id, amount, currency, method, created_at")
    .eq("gym_id", gymId)
    .eq("member_id", memberId)
    .eq("purpose", "registration_fee")
    .eq("status", "verified")
    .is("voided_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (paymentError) {
    return { data: null, error: await mapAndLog(paymentError) };
  }
  if (payment) {
    return {
      data: {
        kind: "paid",
        paymentId: payment.id,
        amount: payment.amount,
        currency: payment.currency,
        method: payment.method,
        // The settle time, not the row's insert time: a Tara fee row is created
        // at initiation and only settles when the webhook confirms.
        paidAt: member.registration_fee_settled_at,
      },
      error: null,
    };
  }

  // Story 22.4: the service-role audit read is gated by the actor's LIVE role and gym, not by a
  // token claim. The live role also decides whether names and reasons are shown.
  const authz = await authorizeAction("member.registration_fee_state", { gymId });
  if (!authz.ok) {
    return { data: null, error: authz.error };
  }
  const role = authz.role;

  const admin = createAdminClient();
  const { data: waived, error: waivedError } = await admin
    .from("audit_log")
    .select("actor_id, actor_display_name, metadata, created_at")
    .eq("gym_id", gymId)
    .eq("action_type", "registration_fee_waived")
    .eq("target_entity_id", memberId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (waivedError) {
    return { data: null, error: await mapAndLog(waivedError) };
  }
  if (!waived) {
    return { data: { kind: "none" }, error: null };
  }
  if (!AUDIT_READER_ROLES.has(role)) {
    return { data: { kind: "waived", waivedByName: null, reason: null }, error: null };
  }

  let waivedByName: string | null = waived.actor_display_name || null;
  if (waived.actor_id) {
    const { data: actorRows, error: actorError } = await supabase
      .from("members")
      .select("user_id, name")
      .eq("gym_id", gymId)
      .in("user_id", [waived.actor_id]);
    if (actorError) {
      return { data: null, error: await mapAndLog(actorError) };
    }
    waivedByName = actorRows?.[0]?.name ?? waivedByName;
  }

  const metadata = (waived.metadata ?? {}) as { reason?: unknown };
  return {
    data: {
      kind: "waived",
      waivedByName,
      reason: typeof metadata.reason === "string" ? metadata.reason : null,
    },
    error: null,
  };
}

const MEMBER_ID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Story 19.10: one member as a list row, for the `/members?memberId=` deep
 * link from the Guest sessions page (it opens the AD-04 modal on load, which
 * needs the same `MemberListRow` the list passes it). Gym-scoped and
 * `role = "member"` like `listMembers`; a malformed id, another gym's member or
 * a staff row all read as `null` data with no error -- the page then simply
 * opens no modal. */
export async function getMemberListRow(
  memberId: string,
): Promise<{ data: MemberListRow | null; error: AppError | null }> {
  if (!MEMBER_ID_SHAPE.test(memberId)) {
    return { data: null, error: null };
  }

  const supabase = await createClient();
  const { gymId, error: gymIdError } = await getCallerGymId(supabase);
  if (gymIdError || !gymId) {
    return { data: null, error: gymIdError };
  }

  const { data, error } = await supabase
    .from("members")
    .select(
      "id, name, phone, email, dob, photo_url, emergency_contact, birth_year, profession, neighborhood, join_date, deactivated_at, registration_fee_settled_at, subscriptions(status, expiry_date, plan_id, created_at, plans(name, plan_type))",
    )
    .eq("gym_id", gymId)
    .eq("role", "member")
    .eq("id", memberId)
    .order("created_at", { referencedTable: "subscriptions", ascending: false })
    .limit(1, { referencedTable: "subscriptions" })
    .maybeSingle();

  if (error) {
    return { data: null, error: await mapAndLog(error) };
  }
  return { data: data ? toMemberListRow(data as unknown as MemberRowFromDb) : null, error: null };
}
