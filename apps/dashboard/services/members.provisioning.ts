import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { type AppError } from "@gymos/types";
import { mapAndLog } from "@/services/session";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getServerTranslation } from "@/lib/i18n/get-server-translation";
import { authorizeAction } from "@/lib/authz";
import { type MemberSubscriptionStatus, getCallerGymId, memberNotFoundError } from "./members.shared";

// Member provisioning: auth user lookup/creation, member and subscription inserts, import rows and the
// cleanup paths (split out of members.ts, Epic 20 retro G-2). members.ts re-exports the public names.

/** Scope Note #1's find-or-create-by-phone flow. Uses the Admin API client
 * -- `public.users` has no Manager/Owner SELECT policy that would let a
 * regular session look up a *different* user's row by phone
 * (`self_read_own_user`, 0015, is scoped to `id = auth.uid()` only), so this
 * lookup structurally requires elevated privilege regardless of the
 * `createUser` call below. `phone_confirm: false` (unlike `createGym`'s
 * owner-account precedent, which uses `true`) -- a member authenticates via
 * phone/OTP only, and their real first OTP verification in Story 2.6 is
 * what actually confirms the phone. */
export async function findOrCreateUserByPhone(
  phone: string,
): Promise<{ data: { userId: string; created: boolean } | null; error: AppError | null }> {
  // Story 22.4: live authorization before the service-role client does anything.
  const authz = await authorizeAction("member.provision");
  if (!authz.ok) {
    return { data: null, error: authz.error };
  }

  const admin = createAdminClient();

  // GoTrue stores auth.users.phone (and this trigger-copied public.users.phone,
  // 0003_members_and_users.sql:62-63) in E.164 digits WITHOUT the leading "+"
  // -- confirmed empirically against this project's local Supabase instance:
  // createUser({ phone: "+237699000777" }) persists as "237699000777", and
  // `select ... where phone = '+237699000777'` returns 0 rows against that same
  // account. Every Zod e164Phone schema in this codebase REQUIRES the leading
  // "+" (`/^\+[1-9]\d{7,14}$/`, member.ts:9, csvImport.ts:24-26), so a raw
  // `.eq("phone", phone)` here never matches an existing row: the lookup falls
  // through to createUser(), GoTrue's own (consistently normalized) uniqueness
  // check rejects it with `phone_exists`, and the caller sees a confusing
  // "already registered" rejection instead of the existing account being
  // reused. That breaks adding an already-registered person as a member at a
  // second gym, which is precisely what multi-gym support exists for.
  //
  // This is the same defect createStaffMember() carried and fixed in Story 9.4
  // (staff.ts:200-213); members.ts was modelled on it but never received the
  // fix. Normalize in BOTH lookups below -- see the race-recovery re-query.
  const normalizedPhoneForLookup = phone.replace(/^\+/, "");

  const { data: existing, error: lookupError } = await admin
    .from("users")
    .select("id")
    .eq("phone", normalizedPhoneForLookup)
    .maybeSingle();
  if (lookupError) {
    return { data: null, error: await mapAndLog(lookupError) };
  }
  if (existing) {
    // STAFF/MEMBER PHONE SEPARATION (migration 0094). A phone that already
    // holds an active STAFF row may not also become a member -- a session
    // carries one app_role, so one account being both is ambiguous.
    //
    // Reuse across gyms stays correct and is NOT blocked: FR-001 says "a user
    // may be a member at multiple gyms via separate `members` rows"
    // (epics.md:26), and per-gym notification preferences and the gym-named
    // expiry copy both implement it.
    //
    // Checked here rather than left to the database purely for the copy --
    // 0094's trigger is the real enforcement and also covers CSV import,
    // direct writes and the race between this read and the insert, but a raw
    // check_violation is not something to show a receptionist.
    const { data: conflicts, error: conflictError } = await admin
      .from("members")
      .select("role")
      .eq("user_id", existing.id)
      .is("deactivated_at", null);
    if (conflictError) {
      return { data: null, error: await mapAndLog(conflictError) };
    }

    if (conflicts?.some((row) => row.role !== "member")) {
      const { t } = await getServerTranslation(await getRequestLocale());
      return {
        data: null,
        error: { code: "phone_belongs_to_staff", message: t("members.errors.phoneBelongsToStaffAccount") },
      };
    }

    return { data: { userId: existing.id, created: false }, error: null };
  }

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    phone,
    phone_confirm: false,
  });

  if (createError || !created?.user) {
    // Race window: another session created an auth.users row for this exact
    // brand-new phone a moment earlier. GoTrue reports this as a
    // `phone_exists` error -- self-heal by re-querying instead of
    // surfacing it as a failure (Scope Note #1), rather than a genuine
    // provisioning error.
    if ((createError as { code?: string } | null)?.code === "phone_exists") {
      // Normalized for the same reason as the lookup above. This one is
      // load-bearing for the SYMPTOM: while both comparisons carried the "+",
      // the first lookup missed, createUser() raised `phone_exists`, and then
      // this self-heal re-query missed too -- so the error surfaced rather
      // than the existing account being reused. Fixing only the first lookup
      // would leave this path broken under a genuine race.
      const { data: reQueried, error: reQueryError } = await admin
        .from("users")
        .select("id")
        .eq("phone", normalizedPhoneForLookup)
        .maybeSingle();
      if (reQueryError) {
        return { data: null, error: await mapAndLog(reQueryError) };
      }
      if (reQueried) {
        // Not created by this call -- another session's request won the
        // race, so `created: false` here too (deleting it on a later
        // failure would be destructive to that other request).
        return { data: { userId: reQueried.id, created: false }, error: null };
      }
    }
    return { data: null, error: await mapAndLog(createError) };
  }

  return { data: { userId: created.user.id, created: true }, error: null };
}

/** A cleanup may only undo what the same request just created: nothing older than this (epic 22 retro, cleanup helpers). */
const CLEANUP_MAX_AGE_MS = 60 * 60 * 1000;

/** Compensating cleanup for `createMember`'s orchestration: if `insertMember`
 * fails (cap-trigger race, RLS, unexpected error) after
 * `findOrCreateUserByPhone` freshly provisioned a brand-new `auth.users` row
 * in the same request (`created: true` -- never called when an existing
 * account was reused, which would make this destructive to that other
 * membership), delete that orphaned placeholder account rather than leave it
 * permanently unattached to any member. Mirrors `deleteMemberForCleanup`'s
 * same no-cross-table-transaction rationale. */
export async function deleteAuthUserForCleanup(userId: string): Promise<void> {
  const admin = createAdminClient();
  // Epic 22 retro (cleanup helpers): this deletes with the service-role key, which bypasses row-level rules, so it refuses
  // anything but the record it exists to undo: an account created within the last hour, attached to no member, and not a
  // platform (Super Admin) account. Any doubt (a failed lookup) refuses; an orphaned placeholder account is the accepted,
  // logged outcome (see above).
  const refuse = (why: string) => console.error(`[members] cleanup refused to delete auth user ${userId}: ${why}`);
  const { data: found, error: lookupError } = await admin.auth.admin.getUserById(userId);
  const createdAt = found?.user?.created_at ? Date.parse(found.user.created_at) : Number.NaN;
  if (lookupError || !Number.isFinite(createdAt)) return refuse("could not confirm the account is new");
  if (Date.now() - createdAt > CLEANUP_MAX_AGE_MS) return refuse("the account is not fresh");
  const { data: attached, error: attachedError } = await admin.from("members").select("id").eq("user_id", userId).limit(1);
  if (attachedError) return refuse("could not check memberships");
  if ((attached ?? []).length > 0) return refuse("the account belongs to a member");
  const { data: platform, error: platformError } = await admin.from("users").select("is_super_admin").eq("id", userId).maybeSingle();
  if (platformError) return refuse("could not check for a platform account");
  if (platform?.is_super_admin) return refuse("the account is a platform account");

  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) {
    console.error(
      `[members] compensating cleanup failed to delete auth user ${userId} after a failed member insert`,
      error,
    );
  }
}

export interface InsertMemberInput {
  name: string;
  phone: string;
  email: string | null;
  dob: string | null;
  photoUrl: string | null;
  emergencyContact: string | null;
  birthYear: number | null;
  profession: string | null;
  neighborhood: string | null;
  joinDate: string;
}

/** `members.role` is always 'member' for everything this function creates
 * -- enforced again at the RLS `with check` layer
 * (manager_or_owner_insert_own_members, 0018), not just here.
 * `members.phone` is a denormalized copy of `users.phone`/`auth.users.phone`
 * -- both get written at creation (mirrors `insertOwnerMember`'s existing
 * pattern), kept in sync at creation time only (Edit mode excludes phone
 * changes, so no drift-handling is needed here). */
export async function insertMember(
  userId: string,
  input: InsertMemberInput,
): Promise<{ data: { id: string; gymId: string } | null; error: AppError | null }> {
  const supabase = await createClient();
  const { gymId, error: gymIdError } = await getCallerGymId(supabase);
  if (gymIdError || !gymId) {
    return { data: null, error: gymIdError };
  }

  const { data, error } = await supabase
    .from("members")
    .insert({
      gym_id: gymId,
      user_id: userId,
      role: "member",
      name: input.name,
      phone: input.phone,
      email: input.email,
      dob: input.dob,
      photo_url: input.photoUrl,
      join_date: input.joinDate,
      emergency_contact: input.emergencyContact,
      birth_year: input.birthYear,
      profession: input.profession,
      neighborhood: input.neighborhood,
    })
    .select("id")
    .single();

  if (error || !data) {
    return { data: null, error: await mapAndLog(error) };
  }
  return { data: { id: data.id, gymId }, error: null };
}

export interface InsertSubscriptionInput {
  planId: string;
  status: MemberSubscriptionStatus;
  startDate: string;
  expiryDate: string | null;
}

/** `subscriptions.start_date` has no dedicated UI field in AD-05 -- set to
 * the same value as `join_date` at creation (a member's plan starts the day
 * they join). Enforced alongside the plan-type/expiry-date invariant by the
 * `enforce_subscription_expiry_matches_plan_type` trigger (0018) -- a
 * mismatched pair raises there, not here. */
export async function insertSubscription(
  gymId: string,
  memberId: string,
  input: InsertSubscriptionInput,
): Promise<{ data: { id: string } | null; error: AppError | null }> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("subscriptions")
    .insert({
      gym_id: gymId,
      member_id: memberId,
      plan_id: input.planId,
      status: input.status,
      start_date: input.startDate,
      expiry_date: input.expiryDate,
    })
    .select("id")
    .single();

  if (error || !data) {
    return { data: null, error: await mapAndLog(error) };
  }
  return { data, error: null };
}

/** Compensating cleanup for `createMember`'s own multi-step orchestration
 * (no cross-table transaction available via supabase-js, same accepted
 * limitation as `createGym`'s -- deferred-work.md's precedent for this exact
 * class of gap): if `insertSubscription` fails after `insertMember`
 * succeeds, delete the just-created `members` row so it isn't left
 * orphaned. Uses the Admin (service-role) client deliberately -- `members`
 * has no DELETE RLS policy at all (soft-delete only, FR-019), so this
 * narrowly-scoped cleanup-only delete structurally cannot go through the
 * regular session client. Does NOT delete the `auth.users` row even if one
 * was freshly provisioned in the same request -- `findOrCreateUserByPhone`
 * may have *reused* an existing account from another gym's membership;
 * deleting it would be destructive to that other membership. An orphaned
 * brand-new placeholder `auth.users` row is an accepted, logged edge case. */
export async function deleteMemberForCleanup(memberId: string, gymId: string): Promise<void> {
  const admin = createAdminClient();
  // Epic 22 retro (cleanup helpers): service-role delete by id, so it refuses anything but a member row of THIS gym, of role
  // 'member', created within the last hour. A wrong id, a staff row or another gym's member is left alone and logged.
  const { data: row, error: lookupError } = await admin
    .from("members")
    .select("id, created_at")
    .eq("id", memberId)
    .eq("gym_id", gymId)
    .eq("role", "member")
    .maybeSingle();
  const createdAt = row?.created_at ? Date.parse(row.created_at) : Number.NaN;
  if (lookupError || !row || !Number.isFinite(createdAt) || Date.now() - createdAt > CLEANUP_MAX_AGE_MS) {
    console.error(`[members] cleanup refused to delete member ${memberId}: not a fresh member row of this gym`);
    return;
  }
  // subscriptions.member_id references members(id) with no ON DELETE CASCADE
  // -- the member delete below raises a foreign-key violation whenever a
  // subscription row was already committed (e.g. the CSV import batch
  // rollback undoing an earlier, fully-successful row, Scope Note #10). A
  // no-op when called from provisionMemberRow's own single-row cleanup,
  // where the subscription insert is what just failed.
  const { error: subscriptionError } = await admin.from("subscriptions").delete().eq("member_id", memberId);
  if (subscriptionError) {
    console.error(
      `[members] compensating cleanup failed to delete subscription for member ${memberId}`,
      subscriptionError,
    );
  }
  const { error } = await admin.from("members").delete().eq("id", memberId).eq("gym_id", gymId);
  if (error) {
    console.error(
      `[members] compensating cleanup failed to delete member ${memberId} after a failed subscription insert`,
      error,
    );
  }
}

export interface ProvisionMemberRowInput {
  name: string;
  phone: string;
  email: string | null;
  dob: string | null;
  photoUrl: string | null;
  emergencyContact: string | null;
  birthYear: number | null;
  profession: string | null;
  neighborhood: string | null;
  joinDate: string;
  /** Story 18.5: optional. A fee-gym create has no plan and no subscription
   * (the member is awaiting the registration fee); when `planId` is absent
   * the subscription insert is skipped. */
  planId?: string | null;
  subscriptionStatus?: MemberSubscriptionStatus;
  expiryDate?: string | null;
  /** Story 18.5: CSV import of a fee gym. Sets `registration_fee_settled_at`
   * through the admin client between the member insert and the subscription
   * insert, so the 0098 gate lets the imported row's subscription through. No
   * payment is written. The only place in the dashboard that settles a fee
   * without a collection or waiver. */
  importExempt?: boolean;
}

/** Marks a just-created member's registration fee as settled, for the CSV
 * import exemption only. `members.registration_fee_settled_at` is writable by
 * service_role and SECURITY DEFINER functions alone (0098), so this goes
 * through the admin client, the same precedent as `deleteMemberForCleanup`. */
async function settleRegistrationFeeForImport(memberId: string, gymId: string): Promise<{ error: AppError | null }> {
  // The gym comes from the target member row, not from the caller.
  const authz = await authorizeAction("member.provision", { gymId });
  if (!authz.ok) {
    return { error: authz.error };
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("members")
    .update({ registration_fee_settled_at: new Date().toISOString() })
    .eq("gym_id", gymId)
    .eq("id", memberId)
    .select("id")
    .maybeSingle();
  if (error) {
    return { error: await mapAndLog(error) };
  }
  if (!data) {
    return {
      error: await memberNotFoundError("0 rows affected by the import fee-exemption UPDATE (member vanished mid-import)"),
    };
  }
  return { error: null };
}

/** Shared 3-step provisioning orchestration (find-or-create user by phone →
 * insert member → insert subscription, with compensating cleanup on
 * failure) -- extracted from `createMember`'s own inline Steps 3-5 (Story
 * 2.3) so both the single-create Server Action and this story's per-row CSV
 * import loop (Task 3, `confirmCsvImport`) share one implementation instead
 * of duplicating the delicate cleanup semantics. Pure relocation -- no
 * behavior change versus what `createMember` already did, including on the
 * subscription-insert failure path (deletes only the just-created member,
 * never a freshly-provisioned auth user -- `findOrCreateUserByPhone` may
 * have reused an existing account from another gym's membership, so
 * deleting it would be destructive to that other membership; an orphaned
 * brand-new placeholder `auth.users` row is an accepted, logged edge case,
 * same as before this extraction). `authUserCreated` on success (new to
 * this extraction, not part of `createMember`'s prior return shape) lets
 * the CSV import loop track which of its own successful rows would need a
 * compensating auth-user delete if a *later* row in the same batch fails
 * (Scope Note #10) -- `createMember` itself has no use for the flag and
 * simply discards it. `userId` is returned alongside for the same reason --
 * the CSV import loop's rollback needs the auth-user id to pass to
 * `deleteAuthUserForCleanup`, which `createMember` again has no use for. */
export async function provisionMemberRow(
  input: ProvisionMemberRowInput,
): Promise<{
  data: { id: string; gymId: string; userId: string; authUserCreated: boolean } | null;
  error: AppError | null;
}> {
  const { data: userResult, error: userError } = await findOrCreateUserByPhone(input.phone);
  if (userError || !userResult) {
    return { data: null, error: userError };
  }

  const { data: memberRow, error: memberError } = await insertMember(userResult.userId, {
    name: input.name,
    phone: input.phone,
    email: input.email,
    dob: input.dob,
    photoUrl: input.photoUrl,
    emergencyContact: input.emergencyContact,
    birthYear: input.birthYear,
    profession: input.profession,
    neighborhood: input.neighborhood,
    joinDate: input.joinDate,
  });
  if (memberError || !memberRow) {
    if (userResult.created) {
      await deleteAuthUserForCleanup(userResult.userId);
    }
    return { data: null, error: memberError };
  }

  if (input.importExempt) {
    const { error: settleError } = await settleRegistrationFeeForImport(memberRow.id, memberRow.gymId);
    if (settleError) {
      await deleteMemberForCleanup(memberRow.id, memberRow.gymId);
      return { data: null, error: settleError };
    }
  }

  // No plan (a fee-gym create): the member stays awaiting with no subscription.
  if (input.planId) {
    const { error: subscriptionError } = await insertSubscription(memberRow.gymId, memberRow.id, {
      planId: input.planId,
      status: input.subscriptionStatus ?? "active",
      startDate: input.joinDate,
      expiryDate: input.expiryDate ?? null,
    });
    if (subscriptionError) {
      await deleteMemberForCleanup(memberRow.id, memberRow.gymId);
      return { data: null, error: subscriptionError };
    }
  }

  return {
    data: { id: memberRow.id, gymId: memberRow.gymId, userId: userResult.userId, authUserCreated: userResult.created },
    error: null,
  };
}
