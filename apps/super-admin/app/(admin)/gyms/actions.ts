"use server";

import {
  changeGymTierSchema,
  createGymSchema,
  escalateGymAccessSchema,
  gymIdSchema,
  gymStatusChangeSchema,
  overrideGymCapSchema,
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
  updateGymCapOverride,
  updateGymStatus,
  updateGymTier,
} from "@/services/gyms";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getServerTranslation } from "@/lib/i18n/get-server-translation";

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
   */
  tempPassword: string;
}

// Fixed unambiguous alphabet -- excludes 0/O/1/l/I (visually confusable when
// read off a screen or heard over the phone). Length 10 comfortably clears
// config.toml's minimum_password_length = 6; this is a forced-change temp
// credential (must_change_password gate, Task 1/5), not a long-lived secret,
// so simple rejection-sampling (below) is sufficient rigor.
const TEMP_PASSWORD_ALPHABET =
  "23456789ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const TEMP_PASSWORD_LENGTH = 10;

function generateTempPassword(): string {
  const maxValidByte =
    Math.floor(256 / TEMP_PASSWORD_ALPHABET.length) * TEMP_PASSWORD_ALPHABET.length;
  let password = "";
  while (password.length < TEMP_PASSWORD_LENGTH) {
    const bytes = crypto.getRandomValues(new Uint8Array(TEMP_PASSWORD_LENGTH));
    for (const byte of bytes) {
      if (password.length >= TEMP_PASSWORD_LENGTH) break;
      // Reject bytes past the last full multiple of the alphabet's length --
      // avoids the modulo-bias a plain `byte % alphabet.length` would introduce.
      if (byte < maxValidByte) password += TEMP_PASSWORD_ALPHABET[byte % TEMP_PASSWORD_ALPHABET.length];
    }
  }
  return password;
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

  // Step 2: insert the gym.
  const { data: gymRow, error: gymError } = await insertGym({
    name: gym.gymName,
    tierId: gym.tierId,
    status: gym.status,
  });
  if (gymError || !gymRow) {
    return { data: null, error: gymError };
  }

  // Step 3: create the owner's auth.users account (admin client -- the only
  // step in this flow that structurally requires it). Both email and phone
  // are set: email is the Supabase Auth login identifier (matching AD-01/
  // SA-01's existing signInWithPassword({ email, password }) form), phone is
  // stored for display (SA-03's "Owner: Paul Nkusu (+237 6XX XXX XXX)"). A
  // real temp password is generated and sent as plain text over WhatsApp
  // (Step 5, Story 1.11) -- no recovery link is generated anymore (Story
  // 1.5's generateLink mechanism is superseded, see docs/decisions.md).
  // `email_confirm: true` is still set, but its justification changes:
  // previously the recovery link's own GoTrue verify step proved email
  // ownership implicitly; with no link at all, this flag is now the only
  // thing establishing the account as usable (AC #1).
  //
  // createAdminClient() itself (env var non-null assertions) and the first
  // admin call are wrapped together: a misconfigured deployment throwing
  // here must still trigger the same compensating cleanup as every other
  // failure branch, not bypass it via an uncaught exception (code review
  // finding -- this was previously unguarded, after the gym row already
  // existed). An IIFE keeps the try/catch's inferred success type flowing
  // naturally into `admin`/`authUser` below, instead of hand-writing their
  // (fairly gnarly) generic types.
  const temporaryPassword = generateTempPassword();
  const provisioned = await (async () => {
    try {
      const admin = createAdminClient();
      const { data, error: authError } = await admin.auth.admin.createUser({
        email: gym.ownerEmail,
        phone: gym.ownerPhone,
        password: temporaryPassword,
        email_confirm: true,
        phone_confirm: true,
      });

      if (authError || !data?.user) {
        return { ok: false as const, error: await mapAndLog(authError) };
      }
      return { ok: true as const, admin, authUser: data };
    } catch (err) {
      return { ok: false as const, error: await mapAndLog(err) };
    }
  })();

  if (!provisioned.ok) {
    await deleteGym(gymRow.id); // compensating cleanup: no orphaned gym
    return { data: null, error: provisioned.error };
  }
  const { admin, authUser } = provisioned;

  // Step 4: insert the owner's membership row. `must_change_password`
  // defaults `true` at the `users` level (0016 migration's DB default) --
  // no explicit set needed here, matching this codebase's existing
  // preference for DB-level defaults over app-level explicit sets.
  const { error: memberError } = await insertOwnerMember({
    gymId: gymRow.id,
    userId: authUser.user.id,
    name: gym.ownerName,
    phone: gym.ownerPhone,
  });

  if (memberError) {
    // Two-deep compensating cleanup: gym and the just-created auth user.
    await deleteGym(gymRow.id);
    await deleteAuthUserAndLog(admin, authUser.user.id);
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
  let sendResult: TempPasswordMessageResult;
  try {
    sendResult = await sendTempPasswordMessage(gym.ownerPhone, temporaryPassword);
  } catch (err) {
    sendResult = {
      success: false,
      error: err instanceof Error ? err.message : "temp-password send threw unexpectedly",
    };
  }
  const smsSent = sendResult.success;
  if (!sendResult.success) {
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
  await logGymCreated(gymRow.id, {
    owner_name: gym.ownerName,
    owner_phone: gym.ownerPhone,
    tier_id: gym.tierId,
    sms_sent: smsSent,
  });

  return {
    data: { gymId: gymRow.id, ownerPhone: gym.ownerPhone, smsSent, tempPassword: temporaryPassword },
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
 * this file, there is no separate mutation followed by an audit-log call --
 * the `gym_data_escalation` audit_log row itself is the access grant (0012
 * migration's design note). If the write fails, nothing was granted, so the
 * error propagates directly as a real, blocking error -- never the benign
 * `audit_log_failed` shape the lifecycle/tier/cap actions use, since there
 * that code means "the real change already saved" and here there is no
 * other change that could have already saved.
 *
 * Deliberately no no-op guard: a repeat escalation for a gym the caller has
 * already escalated to is still a legitimate, distinct, audit-worthy event
 * (a new reason, a new point-in-time record), not a meaningless duplicate
 * state transition.
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
