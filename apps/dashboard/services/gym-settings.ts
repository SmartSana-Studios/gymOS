import { createClient } from "@/lib/supabase/server";
import { type AppError, type GymSettingsInput } from "@gymos/types";
import { mapAndLog } from "@/services/session";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getServerTranslation } from "@/lib/i18n/get-server-translation";

// A Map (not a plain object) so an attacker-controlled `file.type` string
// like "constructor"/"toString" can never resolve via the prototype chain --
// a plain object's bracket access and `in` operator both walk Object.prototype.
export const ALLOWED_LOGO_MIME_TYPES = new Map<string, string>([
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/webp", "webp"],
  ["image/gif", "gif"],
]);

export const MAX_LOGO_BYTES = 5 * 1024 * 1024;

export interface GymSettingsRow {
  gymName: string;
  logoUrl: string | null;
  primaryColor: string | null;
  /** Story 21.2: stable category code (0123); saved through `set_gym_category()`, never the main settings update. */
  category: string;
  timezone: string;
  defaultLanguage: string;
  /** ISO 3166-1 alpha-2; default region for phone numbers without a country code. */
  country: string;
  gracePeriodDays: number;
  capacity: number | null;
  alertAutoDismissMinutes: number;
  checkinTimeoutHours: number;
  /** "HH:MM" gym-local, or null when not set (0158: quiet-gym alerts then default to 06:00-22:00). */
  openingTime: string | null;
  closingTime: string | null;
  gymToken: string;
  registrationFee: number;
  /** Story 19.8: whether the gym charges Pay-per-session guests per session (0107). */
  chargeGuestsPerSession: boolean;
  /** Story 20.5: loyalty program switch and thresholds (0117). Thresholds are null until first configured. */
  loyaltyEnabled: boolean;
  loyaltyGuestThreshold: number | null;
  loyaltyRenewalThreshold: number | null;
  loyaltyRewardDays: number | null;
}

/** Shared by every "0 rows affected" (RLS-denied) / "no gym_id claim" branch
 * in this file -- one translation lookup, one message. `context` is logged
 * server-side only (never shown to the caller) so a denied write attempt
 * (e.g. a non-owner session hitting `owner_update_own_gym`'s RLS gap) leaves
 * an observability trail instead of silently collapsing into the same
 * generic "not found" response as a stale claim. */
async function gymNotFoundError(context: string): Promise<AppError> {
  console.warn(`[gym-settings] resolved to not_found: ${context}`);
  const { t } = await getServerTranslation(await getRequestLocale());
  return { code: "not_found", message: t("settings.errors.gymNotFound") };
}

/** Every function in this file needs the caller's own `gym_id`, read from
 * claims -- `getClaims()`, not `getUser()` (established convention, Story
 * 1.7's Review Findings, reaffirmed in Story 1.8). Factored into one helper
 * so the claims lookup isn't repeated four times. */
async function getCallerGymId(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<{ gymId: string | null; error: AppError | null }> {
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();

  if (claimsError) {
    return { gymId: null, error: await mapAndLog(claimsError) };
  }

  const gymId = (claimsData?.claims as { gym_id?: string } | undefined)?.gym_id;
  if (!gymId) {
    return { gymId: null, error: await gymNotFoundError("no gym_id claim on caller's session") };
  }

  return { gymId, error: null };
}

/** Reads the caller's own gym via `private.gym_id()`-backed "read own gym"
 * policy (0009_auth_hook_gym_claims.sql). */
export async function getGymSettings(): Promise<{
  data: GymSettingsRow | null;
  error: AppError | null;
}> {
  const supabase = await createClient();
  const { gymId, error: gymIdError } = await getCallerGymId(supabase);
  if (gymIdError || !gymId) {
    return { data: null, error: gymIdError };
  }

  const { data, error } = await supabase
    .from("gyms")
    .select(
      "name, logo_url, primary_color, timezone, default_language, country, grace_period_days, capacity, alert_auto_dismiss_minutes, checkin_timeout_hours, opening_time, closing_time, gym_token, registration_fee, charge_guests_per_session, loyalty_enabled, loyalty_guest_threshold, loyalty_renewal_threshold, loyalty_reward_days, category",
    )
    .eq("id", gymId)
    .maybeSingle();

  if (error) {
    return { data: null, error: await mapAndLog(error) };
  }
  if (!data) {
    return { data: null, error: await gymNotFoundError("gym row not found for read (stale claim or RLS-denied)") };
  }

  return {
    data: {
      gymName: data.name,
      logoUrl: data.logo_url,
      primaryColor: data.primary_color,
      category: data.category,
      timezone: data.timezone,
      defaultLanguage: data.default_language,
      country: data.country,
      gracePeriodDays: data.grace_period_days,
      capacity: data.capacity,
      alertAutoDismissMinutes: data.alert_auto_dismiss_minutes,
      checkinTimeoutHours: data.checkin_timeout_hours,
      openingTime: data.opening_time ? data.opening_time.slice(0, 5) : null,
      closingTime: data.closing_time ? data.closing_time.slice(0, 5) : null,
      gymToken: data.gym_token,
      registrationFee: data.registration_fee,
      chargeGuestsPerSession: data.charge_guests_per_session,
      loyaltyEnabled: data.loyalty_enabled,
      loyaltyGuestThreshold: data.loyalty_guest_threshold,
      loyaltyRenewalThreshold: data.loyalty_renewal_threshold,
      loyaltyRewardDays: data.loyalty_reward_days,
    },
    error: null,
  };
}

/** Story 17.2 (AC #10): the current gym-local calendar periods, for the
 * Overview's gym-health counts. Dates for the month, because
 * `members.join_date` is a `date`; UTC instants for the day, because
 * `class_sessions.scheduled_at` is a `timestamptz`. Both upper bounds are
 * exclusive. */
export interface GymLocalPeriodBounds {
  monthStartDate: string;
  nextMonthStartDate: string;
  dayStart: string;
  nextDayStart: string;
}

/** Story 17.2 (AC #10): calls `gym_local_period_bounds()` (0097) with no
 * arguments -- the gym comes from `private.gym_id()` server-side, so no
 * `getCallerGymId()` here. Zero rows (no `gym_id` claim, or no visible gym)
 * is `not_found`, never an invented window; deliberately not `.single()`, so
 * that branch is logged by this file's own helper. */
export async function getGymLocalPeriodBounds(): Promise<{
  data: GymLocalPeriodBounds | null;
  error: AppError | null;
}> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("gym_local_period_bounds");

  if (error) {
    return { data: null, error: await mapAndLog(error) };
  }

  const row = data?.[0];
  if (!row) {
    return { data: null, error: await gymNotFoundError("gym_local_period_bounds returned no row") };
  }

  return {
    data: {
      monthStartDate: row.month_start_date,
      nextMonthStartDate: row.next_month_start_date,
      dayStart: row.day_start,
      nextDayStart: row.next_day_start,
    },
    error: null,
  };
}

/** Relies entirely on the `owner_update_own_gym` RLS policy
 * (0014_gym_settings_owner_access.sql) for authorization -- a non-owner
 * caller's UPDATE affects 0 rows, not an error. Chains .select().maybeSingle()
 * to distinguish that silent no-op from a real success, same pattern as
 * `updateTier` (apps/super-admin/services/tiers.ts). */
export async function updateGymSettings(
  input: GymSettingsInput,
): Promise<{ error: AppError | null }> {
  const supabase = await createClient();
  const { gymId, error: gymIdError } = await getCallerGymId(supabase);
  if (gymIdError || !gymId) {
    return { error: gymIdError };
  }

  const { data, error } = await supabase
    .from("gyms")
    .update({
      name: input.gymName,
      logo_url: input.logoUrl,
      primary_color: input.primaryColor,
      timezone: input.timezone,
      default_language: input.defaultLanguage,
      country: input.country,
      grace_period_days: input.gracePeriodDays,
      capacity: input.capacity,
      alert_auto_dismiss_minutes: input.alertAutoDismissMinutes,
      checkin_timeout_hours: input.checkinTimeoutHours,
      opening_time: input.openingTime,
      closing_time: input.closingTime,
    })
    .eq("id", gymId)
    .select("id")
    .maybeSingle();

  if (error) {
    return { error: await mapAndLog(error) };
  }
  if (!data) {
    return { error: await gymNotFoundError("0 rows affected by settings UPDATE (non-owner session or stale claim)") };
  }
  return { error: null };
}

/** Uploads to `{gymId}/logo.{ext}` with `upsert: true` so re-uploads
 * overwrite rather than orphan old files. Enforces type/size here (not just
 * in the Server Action wrapper) so any direct caller of this function is
 * covered too. New file is uploaded *before* any stale-extension file is
 * removed, and the `gyms.logo_url` DB write is rolled back with a
 * best-effort delete of the just-uploaded object if it fails -- avoids the
 * two failure modes of the original delete-then-upload ordering: a failed
 * upload leaving the gym with no logo at all, and a failed DB update leaving
 * an orphaned Storage object with a stale DB pointer. */
export async function uploadGymLogo(
  file: File,
): Promise<{ data: { logoUrl: string } | null; error: AppError | null }> {
  const supabase = await createClient();
  const { gymId, error: gymIdError } = await getCallerGymId(supabase);
  if (gymIdError || !gymId) {
    return { data: null, error: gymIdError };
  }

  const ext = ALLOWED_LOGO_MIME_TYPES.get(file.type);
  if (!ext) {
    const { t } = await getServerTranslation(await getRequestLocale());
    return {
      data: null,
      error: { code: "validation_error", message: t("settings.errors.unsupportedType") },
    };
  }
  if (file.size === 0 || file.size > MAX_LOGO_BYTES) {
    const { t } = await getServerTranslation(await getRequestLocale());
    return {
      data: null,
      error: { code: "validation_error", message: t("settings.errors.imageTooLarge") },
    };
  }
  const path = `${gymId}/logo.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from("gym-logos")
    .upload(path, file, { upsert: true });

  if (uploadError) {
    return { data: null, error: await mapAndLog(uploadError) };
  }

  const {
    data: { publicUrl },
  } = supabase.storage.from("gym-logos").getPublicUrl(path);

  const { data, error: updateError } = await supabase
    .from("gyms")
    .update({ logo_url: publicUrl })
    .eq("id", gymId)
    .select("id")
    .maybeSingle();

  if (updateError || !data) {
    const { error: rollbackError } = await supabase.storage.from("gym-logos").remove([path]);
    if (rollbackError) {
      console.error(
        `[uploadGymLogo] DB update failed and rollback delete of ${path} also failed -- orphaned Storage object likely remains`,
        rollbackError,
      );
    }
    return {
      data: null,
      error: updateError
        ? await mapAndLog(updateError)
        : await gymNotFoundError("0 rows affected by logo_url UPDATE (non-owner session or stale claim)"),
    };
  }

  const { error: auditError } = await logGymSettingsChange("gym_settings_updated", { logo_url: publicUrl });
  if (auditError) {
    console.error(`[uploadGymLogo] audit log write failed for gym ${gymId}`, auditError);
  }

  // The upload path is keyed by MIME-derived extension, not the client's
  // filename, so a re-upload under a different original extension (e.g. .jpg
  // after a prior .png) would otherwise leave a second object behind instead
  // of overwriting the first. Cleaned up *after* the new logo is confirmed
  // live in the DB, not before -- a failure here is logged but never fails
  // the request, since the new logo has already saved successfully.
  const { data: existingFiles, error: listError } = await supabase.storage.from("gym-logos").list(gymId);
  if (listError) {
    console.error(`[uploadGymLogo] listing ${gymId} for stale-file cleanup failed`, listError);
  } else {
    const staleFiles = (existingFiles ?? [])
      .filter((entry) => entry.name.startsWith("logo.") && entry.name !== `logo.${ext}`)
      .map((entry) => `${gymId}/${entry.name}`);
    if (staleFiles.length > 0) {
      const { error: removeError } = await supabase.storage.from("gym-logos").remove(staleFiles);
      if (removeError) {
        console.error(`[uploadGymLogo] removing stale logo files ${staleFiles.join(", ")} failed`, removeError);
      }
    }
  }

  return { data: { logoUrl: publicUrl }, error: null };
}

/** `gym_token` has a `unique` constraint (0002_gyms_and_tiers.sql) -- a
 * collision is effectively impossible (UUID v4) and needs no retry logic. */
export async function regenerateQrCode(): Promise<{
  data: { gymToken: string } | null;
  error: AppError | null;
}> {
  const supabase = await createClient();
  const { gymId, error: gymIdError } = await getCallerGymId(supabase);
  if (gymIdError || !gymId) {
    return { data: null, error: gymIdError };
  }

  const { data, error } = await supabase
    .from("gyms")
    .update({ gym_token: crypto.randomUUID() })
    .eq("id", gymId)
    .select("gym_token")
    .maybeSingle();

  if (error) {
    return { data: null, error: await mapAndLog(error) };
  }
  if (!data) {
    return { data: null, error: await gymNotFoundError("0 rows affected by gym_token UPDATE (non-owner session or stale claim)") };
  }
  return { data: { gymToken: data.gym_token }, error: null };
}

/** Thin wrapper over `log_audit_event`, following `logTierChange`'s pattern
 * exactly (apps/super-admin/services/tiers.ts): same `{error}`-only return
 * shape, same "audit write failed" console.error + mapAndLog. */
export async function logGymSettingsChange(
  actionType: "gym_settings_updated" | "gym_qr_code_regenerated",
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
    p_target_entity_id: gymId,
    p_target_entity_type: "gym",
    p_metadata: metadata,
  });

  if (error) {
    console.error(`[logGymSettingsChange] audit log write failed for gym ${gymId}`, error);
    return { error: await mapAndLog(error) };
  }
  return { error: null };
}

/** Story 18.1: sets the gym's one-time registration fee through
 * `set_registration_fee()` (0098) -- the only write path for
 * `gyms.registration_fee`, which is pinned against direct UPDATEs (including
 * `updateGymSettings`'s). The RPC is the real authorization boundary
 * (owner/supervisor, active gym, amount >= 0) and writes the
 * `registration_fee_changed` audit row itself, so there is no separate
 * `logGymSettingsChange` call; this function only relays the call. */
export async function setRegistrationFee(
  amount: number,
): Promise<{ data: { ok: true } | null; error: AppError | null }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_registration_fee", { p_amount: amount });
  if (error) {
    return { data: null, error: await mapAndLog(error) };
  }
  return { data: { ok: true }, error: null };
}

/** Story 19.9a: the number of members who would start needing a paid session
 * if charging were switched on, from `guest_charging_impact()` (0107). The RPC
 * is the authorization boundary (owner/supervisor, own gym). */
export async function getGuestChargingImpact(): Promise<{ data: number | null; error: AppError | null }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("guest_charging_impact");
  if (error) {
    return { data: null, error: await mapAndLog(error) };
  }
  return { data: data ?? 0, error: null };
}

/** Story 19.9a: turns per-session guest charging on or off through
 * `set_guest_charging()` (0107) -- the only write path for
 * `gyms.charge_guests_per_session`, which `updateGymSettings` never touches.
 * The RPC checks owner/supervisor and an active gym, and writes the
 * `guest_charging_changed` audit row itself. */
export async function setGuestCharging(
  enabled: boolean,
): Promise<{ data: { ok: true } | null; error: AppError | null }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_guest_charging", { p_enabled: enabled });
  if (error) {
    return { data: null, error: await mapAndLog(error) };
  }
  return { data: { ok: true }, error: null };
}

/** Story 20.5: sets the loyalty program through `set_loyalty_program()` (0117),
 * the only write path for the four `gyms.loyalty_*` columns. The RPC checks
 * owner/supervisor, an active gym and the N/K/R ranges, and writes the audit
 * row itself. The generated argument types are non-null, so a caller switching
 * the program off passes the stored (or default) thresholds, which the RPC
 * ignores while disabling. */
export async function setLoyaltyProgram(input: {
  enabled: boolean;
  n: number;
  k: number;
  r: number;
}): Promise<{ data: { ok: true } | null; error: AppError | null }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_loyalty_program", {
    p_enabled: input.enabled,
    p_n: input.n,
    p_k: input.k,
    p_r: input.r,
  });
  if (error) {
    return { data: null, error: await mapAndLog(error) };
  }
  return { data: { ok: true }, error: null };
}

/** Story 21.2: sets the gym category through `set_gym_category()` (0123), the
 * only write path for `gyms.category` (pinned against plain UPDATEs). The RPC
 * checks Super Admin or the gym's Owner/Supervisor, an active gym and the code,
 * and writes the audit row itself. */
export async function setGymCategory(
  category: string,
): Promise<{ data: { ok: true } | null; error: AppError | null }> {
  const supabase = await createClient();
  const { gymId, error: gymIdError } = await getCallerGymId(supabase);
  if (gymIdError || !gymId) {
    return { data: null, error: gymIdError };
  }
  const { error } = await supabase.rpc("set_gym_category", {
    p_gym_id: gymId,
    p_category: category,
  });
  if (error) {
    return { data: null, error: await mapAndLog(error) };
  }
  return { data: { ok: true }, error: null };
}

/** Story 23.3: the Owner's "Allow GymOS Support" switch (0137). The RPC is the real
 * boundary: Owner of this gym only, active gym, audited, suspends or restores the
 * switch-suspended assignments in one transaction. */
export async function setAllowGymosSupport(
  on: boolean,
): Promise<{ data: { ok: true } | null; error: AppError | null }> {
  const supabase = await createClient();
  const { gymId, error: gymIdError } = await getCallerGymId(supabase);
  if (gymIdError || !gymId) {
    return { data: null, error: gymIdError };
  }
  const { error } = await supabase.rpc("set_allow_gymos_support", { p_gym_id: gymId, p_on: on });
  if (error) {
    return { data: null, error: await mapAndLog(error) };
  }
  return { data: { ok: true }, error: null };
}

export type GymosSupportState = "off" | "none" | "assigned" | "waiting";

export interface GymosSupportStatus {
  allowed: boolean;
  state: GymosSupportState;
  /** Newest session activity of the gym's support; null = not yet. */
  lastActedAt: string | null;
}

/** Story 23.3: the Owner-only readout (`get_gymos_support_status`). Never an individual or a count. */
export async function getGymosSupportStatus(): Promise<{
  data: GymosSupportStatus | null;
  error: AppError | null;
}> {
  const supabase = await createClient();
  const { gymId, error: gymIdError } = await getCallerGymId(supabase);
  if (gymIdError || !gymId) {
    return { data: null, error: gymIdError };
  }
  const { data, error } = await supabase.rpc("get_gymos_support_status", { p_gym_id: gymId });
  if (error) {
    return { data: null, error: await mapAndLog(error) };
  }
  const row = data?.[0];
  if (!row) {
    return { data: null, error: await gymNotFoundError("no GymOS Support status row") };
  }
  const state: GymosSupportState =
    row.state === "assigned" || row.state === "waiting" || row.state === "none" ? row.state : "off";
  return { data: { allowed: row.allowed, state, lastActedAt: row.last_acted_at ?? null }, error: null };
}

/** Story 23.3: whether the "GymOS Support" staff row shows (the switch is on). Any staff
 * role can read their own gym; a failure hides the row rather than the staff list. */
export async function getAllowGymosSupport(): Promise<boolean> {
  const supabase = await createClient();
  const { gymId } = await getCallerGymId(supabase);
  if (!gymId) return false;
  const { data, error } = await supabase.from("gyms").select("allow_gymos_support").eq("id", gymId).maybeSingle();
  if (error) {
    await mapAndLog(error);
    return false;
  }
  return data?.allow_gymos_support === true;
}
