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
 * What the read-only screen decided. Deliberately carries no side effects:
 * see `screenOwner` for why the split matters.
 */
type OwnerPlan =
  | { ok: true; admin: AdminClient; kind: "create" }
  | { ok: true; admin: AdminClient; kind: "link"; userId: string; ownerNeverSignedIn: boolean }
  | { ok: false; error: AppError };

/**
 * Decides WHICH account will own the new gym, reading only -- it writes
 * nothing at all, which is what makes AC #5's "nothing is written" true by
 * construction for every refusal below.
 *
 * Round-2 review moved account CREATION in here too, and round 3 caught the
 * consequence: minting the `auth.users` row before `insertGym` meant a failed
 * gym insert stranded a real account, and unlike an orphaned gym (removable
 * via `super_admin_delete_orphaned_gyms`, 0010:65-70) there is NO admin path
 * to delete a stray auth user -- `auth.admin.deleteUser` appears only inside
 * compensating-cleanup helpers. So the write moved back out: screen here,
 * insert the gym, then provision. Refusals still touch nothing, and the
 * compensator is `deleteGym` again, whose failure is recoverable.
 */
async function screenOwner(
  gym: {
    ownerEmail: string;
    ownerPhone: string;
    confirmLinkExistingOwner?: boolean;
  },
  t: (key: string, vars?: Record<string, string>) => string,
): Promise<OwnerPlan> {
  try {
    const admin = createAdminClient();
    // Reused from lib/super-admin-provisioning.mjs (Story 1.16 extracted it
    // for exactly this cross-caller reason) -- it handles listUsers() paging.
    const existing = await findUserByEmail(admin, gym.ownerEmail);

    if (!existing) {
      // No account for this email. The phone may still collide: members and
      // staff are provisioned phone-only with NO email (members.ts:386,
      // staff.ts:234), so `findUserByEmail` cannot see them. Say that plainly
      // rather than letting createUser fail with GoTrue's `phone_exists` ->
      // `owner_phone_taken`, which reads as "pick another phone" when the real
      // situation is "this person already has an account". Deliberately NOT
      // linked by phone: phone is the members' identity key, so matching on it
      // would let one mistyped digit hand a gym to an arbitrary gym member.
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
      return { ok: true as const, admin, kind: "create" as const };
    }

    const { data: profile, error: profileError } = await admin
      .from("users")
      .select("is_super_admin, display_name")
      .eq("id", existing.id)
      .maybeSingle();

    if (profileError) {
      return { ok: false as const, error: await mapAndLog(profileError) };
    }

    // FAIL CLOSED on a missing profile row. `profile?.is_super_admin` is falsy
    // when `profile` is null, so the previous form let an account with no
    // `public.users` row through as "not a Super Admin" -- proven in review by
    // stubbing the lookup to null and watching the link succeed. The row is
    // supposed to exist (0003's handle_new_user trigger), but "the trigger
    // always ran" is precisely the assumption 0089 exists because production
    // violated it. An account we cannot classify is not one to hand a gym to.
    if (!profile) {
      return {
        ok: false as const,
        error: {
          code: "owner_profile_missing",
          message: t("errors.ownerProfileMissing"),
        } satisfies AppError,
      };
    }

    // A Super Admin must not also hold a tenant membership: it puts one
    // identity on both sides of the platform/tenant boundary that
    // getDashboardShellContext() and the (admin) layout guard enforce in
    // opposite directions. Story 1.7/1.15's time-boxed escalation grants exist
    // precisely so platform staff reach gym data WITHOUT a permanent membership.
    if (profile.is_super_admin) {
      return {
        ok: false as const,
        error: {
          code: "owner_is_super_admin",
          message: t("errors.ownerIsSuperAdmin"),
        } satisfies AppError,
      };
    }

    // The submitted phone lands on the new `members` row and becomes the owner
    // contact SA-03 displays. Checked here too: a phone belonging to somebody
    // else must not be attached to this owner's gym just because the EMAIL
    // resolved cleanly. Its own number is fine.
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
    //
    // KNOWN LIMITATION: `confirmLinkExistingOwner` is a bare boolean, so the
    // consent is not bound to the account it was granted for. The client
    // clears it whenever the email is edited (CreateGymModal), but a server
    // that resolves a DIFFERENT account for the same address between the two
    // submissions would accept a stale yes. Binding it would mean returning
    // the resolved id to the client and requiring it back; not done here
    // because AppError carries no payload field. Recorded rather than hidden.
    if (!gym.confirmLinkExistingOwner) {
      // `users.display_name` is NULL for every owner createGym provisions --
      // 0003's handle_new_user() writes only (id, phone) -- so falling back to
      // the submitted email would echo the very string a typo got wrong,
      // identifying nothing. `members.name` is populated for every owner.
      // Filtered to role='owner' and ordered, because a multi-gym person (the
      // population this story creates) has several active member rows and an
      // unordered limit(1) could name them by a label from an unrelated gym,
      // differently between attempts.
      const { data: membership } = await admin
        .from("members")
        .select("name")
        .eq("user_id", existing.id)
        .eq("role", "owner")
        .is("deactivated_at", null)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();

      return {
        ok: false as const,
        error: {
          code: "owner_link_requires_confirmation",
          message: t("errors.ownerLinkRequiresConfirmation", {
            owner: membership?.name?.trim() || profile.display_name?.trim() || gym.ownerEmail,
          }),
        } satisfies AppError,
      };
    }

    return {
      ok: true as const,
      admin,
      kind: "link" as const,
      userId: existing.id,
      // An account that has never signed in still holds the temp password
      // issued when its FIRST gym was created -- which nobody may know, if that
      // WhatsApp send failed. The linked path sends nothing, so the UI must not
      // claim "signs in with their current password" here.
      ownerNeverSignedIn: !existing.last_sign_in_at,
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

  // Step 2: decide WHO will own this gym. Read-only -- every refusal it can
  // produce happens before any write, which is what makes AC #5 true by
  // construction rather than by a cleanup that might fail.
  const plan = await screenOwner(gym, t);
  if (!plan.ok) {
    return { data: null, error: plan.error };
  }
  const admin = plan.admin;

  // Step 3: insert the gym. First write of the request.
  // `insertGym` is contracted to map its errors rather than throw, but a
  // throw here (cookies/createClient, network) must not escape past the
  // provisioning below, so it is guarded.
  let gymRow: { id: string } | null = null;
  let gymError: AppError | null = null;
  try {
    const res = await insertGym({
      name: gym.gymName,
      tierId: gym.tierId,
      status: gym.status,
    });
    gymRow = res.data;
    gymError = res.error;
  } catch (err) {
    gymError = await mapAndLog(err);
  }
  if (gymError || !gymRow) {
    return {
      data: null,
      // Defensive: insertGym always maps its own errors, so a null-error
      // miss should be unreachable -- but returning { data: null, error: null }
      // would read as success to every caller.
      error: gymError ?? { code: "gym_insert_failed", message: t("common.somethingWentWrong") },
    };
  }

  // Step 4: provision the owner account, AFTER the gym exists. This ordering
  // is deliberate (round-3 review): if it fails, the compensator is
  // `deleteGym`, and an orphaned gym is removable through
  // `super_admin_delete_orphaned_gyms` (0010:65-70). A stranded auth.users
  // row would not be -- `auth.admin.deleteUser` exists nowhere in this app
  // outside compensating cleanup, so there is no operator path to clear one.
  let ownerOutcome: "created" | "linked" = plan.kind === "link" ? "linked" : "created";
  let ownerUserId: string;
  let temporaryPassword: string | null = null;
  let ownerNeverSignedIn = plan.kind === "link" ? plan.ownerNeverSignedIn : false;

  if (plan.kind === "link") {
    ownerUserId = plan.userId;
  } else {
    const generated = generateTempPassword();
    const provisioned = await (async () => {
      try {
        const { data, error: authError } = await admin.auth.admin.createUser({
          email: gym.ownerEmail,
          phone: gym.ownerPhone,
          password: generated,
          email_confirm: true,
          phone_confirm: true,
        });
        if (authError || !data?.user) {
          return { ok: false as const, error: await mapAndLog(authError) };
        }
        return { ok: true as const, userId: data.user.id };
      } catch (err) {
        return { ok: false as const, error: await mapAndLog(err) };
      }
    })();

    if (!provisioned.ok) {
      // Race window: a concurrent createGym registered this same brand-new
      // email between our screen and this insert. Re-screen rather than
      // reporting owner_email_taken for an address we are willing to link --
      // the re-screen runs the SAME Super Admin, phone and confirmation
      // checks, so a raced account cannot slip past any of them, and an
      // unconfirmed one correctly comes back asking for confirmation.
      const rescreen = await screenOwner(gym, t);
      if (rescreen.ok && rescreen.kind === "link") {
        ownerUserId = rescreen.userId;
        ownerOutcome = "linked";
        ownerNeverSignedIn = rescreen.ownerNeverSignedIn;
      } else {
        await deleteGym(gymRow.id); // recoverable: gym has no members yet
        return { data: null, error: rescreen.ok ? provisioned.error : rescreen.error };
      }
    } else {
      ownerUserId = provisioned.userId;
      temporaryPassword = generated;
    }
  }

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
  // Gated on the password itself, not on ownerOutcome: a password exists iff
  // we created the account, and this way the compiler enforces it.
  if (temporaryPassword !== null) {
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
  let error: unknown = null;
  try {
    ({ error } = await admin.auth.admin.deleteUser(userId));
  } catch (err) {
    // deleteUser rejecting rather than returning { error } would otherwise
    // escape createGym, masking the real failure and stranding the account.
    error = err;
  }
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
