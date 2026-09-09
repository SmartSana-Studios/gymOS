"use server";

import {
  changeGymTierSchema,
  createGymSchema,
  escalateGymAccessSchema,
  gymIdSchema,
  gymStatusChangeSchema,
  overrideGymCapSchema,
  revokeGymAccessSchema,
  type AppError,
} from "@gymos/types";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  sendTempPasswordMessage,
  type TempPasswordMessageResult,
} from "@/lib/messaging/sendTempPasswordMessage";
import {
  deleteGym,
  gymNameExists,
  insertGym,
  insertOwnerMember,
  logGymCreated,
  logGymDataEscalation,
  logGymLifecycleEvent,
  mapAndLog,
  revokeGymDataAccess,
  updateGymCapOverride,
  updateGymStatus,
  updateGymTier,
} from "@/services/gyms";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getServerTranslation } from "@/lib/i18n/get-server-translation";
import { generateTempPassword } from "@/lib/temp-password.mjs";
import { findUserByEmail } from "@/lib/super-admin-provisioning.mjs";

export interface CreateGymResult {
  gymId: string;
  ownerPhone: string;
  /**
   * True once the WhatsApp send attempt (Story 1.11, Twilio Content API)
   * reports success. Reflects the WhatsApp send result despite the "sms"
   * name -- renaming touches more call sites than this story needs; kept
   * for continuity with Story 1.5's original field. The client uses this
   * to show honest copy instead of unconditionally claiming delivery
   * (code review finding on Story 1.5: the toast previously lied about it).
   */
  smsSent: boolean;
  /**
   * The real temp password set on the owner's `auth.users` row. Always
   * surfaced here (Open Question 3, resolved 2026-07-15) as a manual
   * fallback -- mirrors Story 1.5's own precedent (commit `6049e7a`) of
   * showing the fallback unconditionally, not gated behind `smsSent`: a
   * reported WhatsApp send success doesn't guarantee the owner actually
   * saw the message. Ephemeral -- not persisted beyond this return value.
   *
   * `null` when `ownerOutcome === "linked"` (Story 1.17): no account was
   * created, so no temp password exists. The UI must branch on
   * `ownerOutcome` rather than reading a missing password as a send failure.
   */
  tempPassword: string | null;
  /**
   * Story 1.17. Whether this gym's owner account was newly created, or an
   * existing account was linked as the owner of an additional gym.
   *
   * A discriminator rather than a boolean, following Story 1.16's
   * `outcome: "created" | "promoted" | "already_super_admin"` -- that story
   * added it because a no-op was otherwise indistinguishable from a real
   * write, letting the UI claim something that never happened. The same
   * hazard applies here: without it the success toast would offer a temp
   * password that was never set on any account.
   */
  ownerOutcome: "created" | "linked";
  /**
   * Story 1.17 code review. True when a LINKED account has never signed in,
   * meaning it still holds the temp password issued at its first gym's
   * creation -- which nobody may know if that WhatsApp send failed. Always
   * `false` on the created path, where the password is returned above.
   * The UI uses this to avoid asserting "signs in with their current
   * password" to an admin whose owner has no usable credential.
   */
  ownerNeverSignedIn: boolean;
}

type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * Discriminated on `outcome`, so the compiler enforces the invariant "a temp
 * password exists iff we created the account" instead of a `!` at the call
 * site. Code review finding: the first version was a flat object with
 * `temporaryPassword: string | null`, which pushed that guarantee into prose.
 */
type OwnerResolution =
  | {
      ok: true;
      admin: AdminClient;
      userId: string;
      outcome: "created";
      temporaryPassword: string;
      ownerNeverSignedIn: false;
    }
  | {
      ok: true;
      admin: AdminClient;
      userId: string;
      outcome: "linked";
      temporaryPassword: null;
      ownerNeverSignedIn: boolean;
    }
  | { ok: false; error: AppError };

/**
 * Everything that must be true before an EXISTING account may be linked as a
 * gym owner. Extracted so the ordinary lookup path and the `email_exists`
 * race-recovery path cannot drift -- code review found the race branch
 * skipping the Super Admin screen entirely, which would have granted a
 * platform account a tenant membership: the exact state the guard forbids.
 */
async function screenExistingOwner(
  admin: AdminClient,
  existing: { id: string; last_sign_in_at?: string | null },
  gym: { ownerEmail: string; ownerPhone: string; confirmLinkExistingOwner?: boolean },
  t: (key: string, vars?: Record<string, string>) => string,
): Promise<OwnerResolution> {
  const { data: profile, error: profileError } = await admin
    .from("users")
    .select("is_super_admin, display_name")
    .eq("id", existing.id)
    .maybeSingle();

  if (profileError) {
    return { ok: false as const, error: await mapAndLog(profileError) };
  }

  // A Super Admin must not also hold a tenant membership: it puts one
  // identity on both sides of the platform/tenant boundary that
  // getDashboardShellContext() and the (admin) layout guard enforce in
  // opposite directions. Story 1.7/1.15's time-boxed escalation grants exist
  // precisely so platform staff reach gym data WITHOUT a permanent membership.
  if (profile?.is_super_admin) {
    return {
      ok: false as const,
      error: {
        code: "owner_is_super_admin",
        message: t("errors.ownerIsSuperAdmin"),
      } satisfies AppError,
    };
  }

  // The submitted phone lands on the new `members` row and becomes the owner
  // contact SA-03 displays. Checked on this path too (code review): a phone
  // belonging to somebody else must not be attached to this owner's new gym
  // just because the EMAIL resolved cleanly.
  const { data: phoneOwner, error: phoneLookupError } = await admin
    .from("users")
    .select("id")
    .eq("phone", gym.ownerPhone.replace(/^\+/, ""))
    .maybeSingle();

  if (phoneLookupError) {
    return { ok: false as const, error: await mapAndLog(phoneLookupError) };
  }
  if (phoneOwner && phoneOwner.id !== existing.id) {
    return {
      ok: false as const,
      error: {
        code: "owner_phone_belongs_to_other_account",
        message: t("errors.ownerPhoneBelongsToOtherAccount"),
      } satisfies AppError,
    };
  }

  // Linking cannot be undone through the UI: once the membership row exists,
  // `super_admin_delete_orphaned_gyms` (0010:65-70) only permits deleting
  // gyms with NO members. So the admin must be shown WHO this is and accept
  // it, following Story 1.16's named-target convention (UX-DR12).
  if (!gym.confirmLinkExistingOwner) {
    // `users.display_name` is NULL for every owner createGym provisions --
    // 0003's handle_new_user() trigger writes only (id, phone), and nothing
    // in this flow sets it. Falling back to the submitted email would echo
    // back the very string a typo got wrong, identifying nothing. `members.name`
    // is populated for every owner, so it is the identifying label here.
    const { data: membership } = await admin
      .from("members")
      .select("name")
      .eq("user_id", existing.id)
      .is("deactivated_at", null)
      .limit(1)
      .maybeSingle();

    return {
      ok: false as const,
      error: {
        code: "owner_link_requires_confirmation",
        message: t("errors.ownerLinkRequiresConfirmation", {
          owner: membership?.name?.trim() || profile?.display_name?.trim() || gym.ownerEmail,
        }),
      } satisfies AppError,
    };
  }

  return {
    ok: true as const,
    admin,
    userId: existing.id,
    outcome: "linked" as const,
    temporaryPassword: null,
    // An account that has never signed in still holds the temp password
    // issued when its FIRST gym was created -- which nobody may know, if that
    // WhatsApp send failed. The linked path sends nothing, so the UI must not
    // claim "signs in with their current password" here.
    ownerNeverSignedIn: !existing.last_sign_in_at,
  };
}

/**
 * Resolves which `auth.users` account will own the new gym. Every REJECTION
 * it can produce happens before any write, so AC #5's "nothing is written"
 * holds by construction. Note the created path does write (it mints the auth
 * user), which is why `createGym`'s gym-insert failure branch compensates.
 */
async function resolveOwnerAccount(
  gym: {
    ownerEmail: string;
    ownerPhone: string;
    confirmLinkExistingOwner?: boolean;
  },
  t: (key: string, vars?: Record<string, string>) => string,
): Promise<OwnerResolution> {
  try {
    const admin = createAdminClient();
    // `findUserByEmail` is reused from lib/super-admin-provisioning.mjs
    // (extracted there by Story 1.16 for exactly this cross-caller reason)
    // rather than a second lookup being written here -- it handles
    // listUsers() pagination.
    const existing = await findUserByEmail(admin, gym.ownerEmail);
    if (existing) {
      return await screenExistingOwner(admin, existing, gym, t);
    }

    // No account for this email. The phone may still collide -- members and
    // staff are provisioned phone-only with NO email (members.ts:386,
    // staff.ts:234), so `findUserByEmail` cannot see them. Detect that and say
    // so plainly, instead of letting createUser fail with GoTrue's
    // `phone_exists` -> `owner_phone_taken`, which reads as "pick another
    // phone" when the real situation is "this person already has an account".
    // Deliberately NOT linked by phone: phone is the members' identity key, so
    // matching on it would let one mistyped digit hand a gym to an arbitrary
    // gym member -- the hazard the confirmation gate exists to prevent.
    const { data: phoneOwner, error: phoneLookupError } = await admin
      .from("users")
      .select("id")
      .eq("phone", gym.ownerPhone.replace(/^\+/, ""))
      .maybeSingle();

    if (phoneLookupError) {
      return { ok: false as const, error: await mapAndLog(phoneLookupError) };
    }
    if (phoneOwner) {
      return {
        ok: false as const,
        error: {
          code: "owner_phone_belongs_to_other_account",
          message: t("errors.ownerPhoneBelongsToOtherAccount"),
        } satisfies AppError,
      };
    }

    const temporaryPassword = generateTempPassword();
    const { data, error: authError } = await admin.auth.admin.createUser({
      email: gym.ownerEmail,
      phone: gym.ownerPhone,
      password: temporaryPassword,
      email_confirm: true,
      phone_confirm: true,
    });

    if (authError || !data?.user) {
      // Race window: a concurrent createGym for this same brand-new email won
      // between our lookup and this insert. Re-query and run the SAME screen
      // as the ordinary path -- including the Super Admin check, which an
      // earlier version of this branch skipped. A race means our first lookup
      // found nothing, so the caller cannot have sent confirmation; the screen
      // returns `owner_link_requires_confirmation`, which shows the admin the
      // confirmation panel rather than `owner_email_taken` telling them their
      // input is invalid when it is not.
      const raced =
        (authError as { code?: string } | null)?.code === "email_exists"
          ? await findUserByEmail(admin, gym.ownerEmail)
          : null;
      if (raced) {
        return await screenExistingOwner(admin, raced, gym, t);
      }
      return { ok: false as const, error: await mapAndLog(authError) };
    }

    return {
      ok: true as const,
      admin,
      userId: data.user.id,
      outcome: "created" as const,
      temporaryPassword,
      ownerNeverSignedIn: false as const,
    };
  } catch (err) {
    return { ok: false as const, error: await mapAndLog(err) };
  }
}

/**
 * SA-04 Create Gym. Never throws for expected errors -- returns
 * `{ data, error }` per architecture's Process Patterns. See story 1-5's Dev
 * Notes for the full sequencing rationale (compensating cleanup on partial
 * failure, why the admin client is scoped to exactly one call, the SMS-stub
 * decision).
 */
export async function createGym(
  input: unknown,
): Promise<{ data: CreateGymResult | null; error: AppError | null }> {
  const { t } = await getServerTranslation(await getRequestLocale());
  const parsed = createGymSchema.safeParse(input);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    return {
      data: null,
      error: { code: "validation_error", message: firstIssue?.message ?? t("common.invalidInput") },
    };
  }
  const gym = parsed.data;

  // Step 1: fast-fail pre-check (real guarantee is the DB unique index).
  if (await gymNameExists(gym.gymName)) {
    return {
      data: null,
      error: { code: "gym_name_taken", message: t("errors.gymNameTaken") },
    };
  }

  // Step 2: RESOLVE THE OWNER BEFORE WRITING ANYTHING.
  //
  // This block used to sit after the gym insert. Code review moved it here:
  // every rejection below is pure input validation, and running it first
  // makes AC #5's "nothing is written" true BY CONSTRUCTION instead of by a
  // compensating `deleteGym()` that only console.errors when it fails --
  // which would leave an ownerless gym permanently holding the gym name.
  const resolution = await resolveOwnerAccount(gym, t);
  if (!resolution.ok) {
    return { data: null, error: resolution.error };
  }

  // Step 3: insert the gym.
  //
  // Every REJECTION above this line happens before any write (AC #5). The
  // created path, however, does write: it mints the auth user. Hoisting the
  // resolve step inverted the original gym-then-user order, so this failure
  // branch needs the compensation that used to live on the other side --
  // without it a losing `idx_gyms_name_unique` race strands a real account
  // (and its cascaded `public.users` row) holding the owner's email and
  // phone, and the admin's retry then meets a confirmation prompt naming an
  // account this very request created.
  const { data: gymRow, error: gymError } = await insertGym({
    name: gym.gymName,
    tierId: gym.tierId,
    status: gym.status,
  });
  if (gymError || !gymRow) {
    if (resolution.outcome === "created") {
      await deleteAuthUserAndLog(resolution.admin, resolution.userId);
    }
    return {
      data: null,
      // `!gymRow` with a null error would otherwise return { data: null,
      // error: null }, which every caller reads as success.
      error: gymError ?? {
        code: "gym_insert_failed",
        message: t("common.somethingWentWrong"),
      },
    };
  }

  const {
    admin,
    userId: ownerUserId,
    outcome: ownerOutcome,
    temporaryPassword,
    ownerNeverSignedIn,
  } = resolution;

  // Step 4: insert the owner's membership row. `must_change_password`
  // defaults `true` at the `users` level (0016 migration's DB default) --
  // no explicit set needed here, matching this codebase's existing
  // preference for DB-level defaults over app-level explicit sets.
  // A linked owner's `public.users` row is deliberately NOT touched --
  // `must_change_password` is user-level, not per-membership, and resetting
  // it would bounce an established owner back through /auth/update-password
  // just for being given a second gym. `name`/`phone` land on this new
  // `members` row only, which is per-membership by design (a branch may have
  // its own contact details).
  const { error: memberError } = await insertOwnerMember({
    gymId: gymRow.id,
    userId: ownerUserId,
    name: gym.ownerName,
    phone: gym.ownerPhone,
  });

  if (memberError) {
    await deleteGym(gymRow.id);
    // Delete the auth user ONLY when this request created it. On the linked
    // path the account pre-existed and may own other gyms -- deleting it
    // would destroy an unrelated owner's login, and `public.users.id`
    // cascades from `auth.users`, so it would take their profile row with it.
    if (ownerOutcome === "created") {
      await deleteAuthUserAndLog(admin, ownerUserId);
    }
    return { data: null, error: memberError };
  }

  // Step 5: send the temp password over WhatsApp (Story 2.1's already-
  // approved verifications_2fa_template, Task 2). Failure here must NOT
  // roll back the already-successful gym/owner/member creation (AC #7,
  // matches Story 1.5's smsSent-never-blocks-success precedent) -- the
  // temp password is still returned below as a manual UI fallback either way.
  // Explicitly try/catch'd (code review finding) -- gym/owner/member are
  // already committed at this point, so an unexpected throw here must not
  // be allowed to propagate out of createGym and turn a partial success
  // into a reported failure, same discipline as getDashboardAppUrl() below.
  //
  // Skipped entirely on the linked path (Story 1.17): there is no temp
  // password to send, and messaging an established owner a credential they
  // never received would be worse than saying nothing.
  let sendResult: TempPasswordMessageResult = {
    success: false,
    error: "not attempted: owner account already existed, no temp password to send",
  };
  if (ownerOutcome === "created") {
    try {
      sendResult = await sendTempPasswordMessage(gym.ownerPhone, temporaryPassword);
    } catch (err) {
      sendResult = {
        success: false,
        error: err instanceof Error ? err.message : "temp-password send threw unexpectedly",
      };
    }
  }
  const smsSent = sendResult.success;
  if (ownerOutcome === "created" && !sendResult.success) {
    // Best-effort logging only -- gym/owner/member are already successfully
    // created at this point (AC #7), so a throw from getDashboardAppUrl()
    // (e.g. DASHBOARD_APP_URL unset) must not propagate and turn an
    // already-successful creation into a reported failure.
    let loginUrl = "(DASHBOARD_APP_URL not set)";
    try {
      loginUrl = `${getDashboardAppUrl()}/auth/login`;
    } catch {
      // fall through with the placeholder above
    }
    console.error(
      `[createGym] temp-password WhatsApp send failed for ${gym.ownerPhone}; owner can still log in at ${loginUrl} with the temp password shown in the UI`,
      sendResult.error,
    );
  }

  // Step 6: audit log entry -- the natural first entry in a gym's trail.
  // `owner_outcome` rides in the existing metadata rather than becoming a
  // second action_type: the gym was created either way, so the trail should
  // read as one event with a distinguishing detail, not two kinds of event.
  await logGymCreated(gymRow.id, {
    owner_name: gym.ownerName,
    owner_phone: gym.ownerPhone,
    tier_id: gym.tierId,
    // null, not false, on the linked path: no send was attempted, and `false`
    // is indistinguishable from a real WhatsApp failure in any aggregate over
    // the audit trail.
    sms_sent: ownerOutcome === "created" ? smsSent : null,
    owner_outcome: ownerOutcome,
  });

  return {
    data: {
      gymId: gymRow.id,
      ownerPhone: gym.ownerPhone,
      smsSent,
      tempPassword: temporaryPassword,
      ownerOutcome,
      ownerNeverSignedIn,
    },
    error: null,
  };
}

/** Compensating-cleanup helper: deleteUser()'s own result was previously
 * unchecked -- if it fails, an orphaned auth.users row would be left with
 * no trace (code review finding). Logs, does not throw. */
async function deleteAuthUserAndLog(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
): Promise<void> {
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) {
    console.error(
      `[createGym] compensating cleanup failed to delete auth user ${userId}`,
      error,
    );
  }
}

/**
 * Origin of apps/dashboard. Server-only: never sent to the browser, only
 * used to build the login URL logged (Step 5) when the temp-password
 * WhatsApp send fails, so a failure is still debuggable/manually
 * recoverable without guessing the app's own origin.
 */
function getDashboardAppUrl(): string {
  const url = process.env.DASHBOARD_APP_URL;
  if (!url) {
    throw new Error("DASHBOARD_APP_URL is not set");
  }
  return url.replace(/\/+$/, "");
}

/** Shared validation + status-update + audit-log sequence for the three
 * lifecycle actions below -- AC #3 requires a reason for every one of them. */
const STATUS_LABEL_KEY = {
  active: "gyms.create.statusActive",
  suspended: "gyms.create.statusSuspended",
  deactivated: "gyms.create.statusDeactivated",
} as const;

async function changeGymStatus(
  gymId: string,
  status: "active" | "suspended" | "deactivated",
  actionType: "gym_suspended" | "gym_deactivated" | "gym_reinstated",
  input: unknown,
): Promise<{ error: AppError | null }> {
  const { t } = await getServerTranslation(await getRequestLocale());
  if (!gymIdSchema.safeParse(gymId).success) {
    return { error: { code: "validation_error", message: t("gyms.errors.invalidGymId") } };
  }

  const parsed = gymStatusChangeSchema.safeParse(input);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    return {
      error: { code: "validation_error", message: firstIssue?.message ?? t("common.invalidInput") },
    };
  }

  const { data: result, error } = await updateGymStatus(gymId, status);
  if (error) {
    return { error };
  }

  if (result.previousStatus === status) {
    return {
      error: {
        code: "no_op",
        message: t("gyms.errors.alreadyStatus", { status: t(STATUS_LABEL_KEY[status]) }),
      },
    };
  }

  const { error: auditError } = await logGymLifecycleEvent(actionType, gymId, {
    reason: parsed.data.reason,
    status,
    previous_status: result.previousStatus,
  });
  if (auditError) {
    return {
      error: {
        code: "audit_log_failed",
        message: t("gyms.errors.auditLogFailedStatus"),
      },
    };
  }

  return { error: null };
}

export async function suspendGym(
  gymId: string,
  input: unknown,
): Promise<{ error: AppError | null }> {
  return changeGymStatus(gymId, "suspended", "gym_suspended", input);
}

export async function deactivateGym(
  gymId: string,
  input: unknown,
): Promise<{ error: AppError | null }> {
  return changeGymStatus(gymId, "deactivated", "gym_deactivated", input);
}

export async function reinstateGym(
  gymId: string,
  input: unknown,
): Promise<{ error: AppError | null }> {
  return changeGymStatus(gymId, "active", "gym_reinstated", input);
}

/** SA-03 "Change" tier. AC #1: existing members are never automatically
 * reclassified -- this only reassigns which tier the gym is billed
 * against going forward. */
export async function changeGymTier(
  gymId: string,
  input: unknown,
): Promise<{ error: AppError | null }> {
  const { t } = await getServerTranslation(await getRequestLocale());
  if (!gymIdSchema.safeParse(gymId).success) {
    return { error: { code: "validation_error", message: t("gyms.errors.invalidGymId") } };
  }

  const parsed = changeGymTierSchema.safeParse(input);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    return {
      error: { code: "validation_error", message: firstIssue?.message ?? t("common.invalidInput") },
    };
  }

  const { data: result, error } = await updateGymTier(gymId, parsed.data.tierId);
  if (error) {
    return { error };
  }

  if (result.previousTierId === parsed.data.tierId) {
    return { error: { code: "no_op", message: t("gyms.errors.alreadyOnTier") } };
  }

  const { error: auditError } = await logGymLifecycleEvent("gym_tier_changed", gymId, {
    new_tier_id: parsed.data.tierId,
    previous_tier_id: result.previousTierId,
  });
  if (auditError) {
    return {
      error: {
        code: "audit_log_failed",
        message: t("gyms.errors.auditLogFailedTier"),
      },
    };
  }

  return { error: null };
}

/** SA-03 "Override cap". `capOverride: null` clears the override. */
export async function overrideGymCap(
  gymId: string,
  input: unknown,
): Promise<{ error: AppError | null }> {
  const { t } = await getServerTranslation(await getRequestLocale());
  if (!gymIdSchema.safeParse(gymId).success) {
    return { error: { code: "validation_error", message: t("gyms.errors.invalidGymId") } };
  }

  const parsed = overrideGymCapSchema.safeParse(input);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    return {
      error: { code: "validation_error", message: firstIssue?.message ?? t("common.invalidInput") },
    };
  }

  const { data: result, error } = await updateGymCapOverride(gymId, parsed.data.capOverride);
  if (error) {
    return { error };
  }

  if (result.previousCapOverride === parsed.data.capOverride) {
    return {
      error: { code: "no_op", message: t("gyms.errors.alreadySameCap") },
    };
  }

  const { error: auditError } = await logGymLifecycleEvent("gym_cap_overridden", gymId, {
    cap_override: parsed.data.capOverride,
    previous_cap_override: result.previousCapOverride,
  });
  if (auditError) {
    return {
      error: {
        code: "audit_log_failed",
        message: t("gyms.errors.auditLogFailedCap"),
      },
    };
  }

  return { error: null };
}

/**
 * SA-03 "Access gym data" escalation (FR-072). Unlike every other action in
 * this file, there is no separate mutation followed by an audit-log call:
 * `escalate_gym_data_access()` writes the grant row and its audit entry in
 * one transaction (Story 1.15's 0085; before that the audit row itself was
 * the grant, per 0012's design note). If it fails, nothing was granted, so
 * the error propagates directly as a real, blocking error -- never the
 * benign `audit_log_failed` shape the lifecycle/tier/cap actions use, since
 * there that code means "the real change already saved" and here there is
 * no other change that could have already saved.
 *
 * Deliberately no no-op guard: a repeat escalation for a gym the caller has
 * already escalated to is still a legitimate, distinct, audit-worthy event
 * (a new reason, a new point-in-time record), not a meaningless duplicate
 * state transition. As of Story 1.15 it also starts a fresh 24-hour window,
 * which is exactly what someone re-escalating after a lapse wants.
 */
export async function escalateGymAccess(
  gymId: string,
  input: unknown,
): Promise<{ error: AppError | null }> {
  const { t } = await getServerTranslation(await getRequestLocale());
  if (!gymIdSchema.safeParse(gymId).success) {
    return { error: { code: "validation_error", message: t("gyms.errors.invalidGymId") } };
  }

  const parsed = escalateGymAccessSchema.safeParse(input);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    return {
      error: { code: "validation_error", message: firstIssue?.message ?? t("common.invalidInput") },
    };
  }

  return logGymDataEscalation(gymId, parsed.data.reason);
}

/**
 * SA-03 "Revoke access" (Story 1.15 AC #4). Any Super Admin may revoke any
 * other's active grant on a gym -- all Super Admins are peers, and every
 * revocation is audit-logged with the revoker's identity, so this is
 * self-policing rather than hierarchical.
 *
 * `actorId` is the grant HOLDER (the admin losing access), not the caller.
 * It is validated with `gymIdSchema` -- the same bare `z.uuid()` the gym id
 * uses -- because that is all the shape validation a user id needs here;
 * the real authorization check is `revoke_gym_data_access()`'s own internal
 * `private.is_super_admin()` gate, and a well-formed uuid that matches no
 * grant simply revokes 0 rows.
 *
 * `revokedCount: 0` is surfaced rather than swallowed: it means the grant
 * had already lapsed or been revoked by someone else, and the UI should say
 * so instead of claiming to have just stopped access that was already gone.
 */
export async function revokeGymAccess(
  gymId: string,
  actorId: string,
  input: unknown,
): Promise<{ data: { revokedCount: number } | null; error: AppError | null }> {
  const { t } = await getServerTranslation(await getRequestLocale());
  if (!gymIdSchema.safeParse(gymId).success) {
    return { data: null, error: { code: "validation_error", message: t("gyms.errors.invalidGymId") } };
  }
  if (!gymIdSchema.safeParse(actorId).success) {
    return { data: null, error: { code: "validation_error", message: t("gyms.errors.invalidActorId") } };
  }

  const parsed = revokeGymAccessSchema.safeParse(input);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    return {
      data: null,
      error: { code: "validation_error", message: firstIssue?.message ?? t("common.invalidInput") },
    };
  }

  return revokeGymDataAccess(gymId, actorId, parsed.data.reason);
}
