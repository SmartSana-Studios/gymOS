"use server";

import { connectGymPaymentCredentialsSchema, gymSettingsSchema, type AppError } from "@gymos/types";
import {
  ALLOWED_LOGO_MIME_TYPES,
  MAX_LOGO_BYTES,
  logGymSettingsChange,
  regenerateQrCode as regenerateQrCodeRow,
  updateGymSettings,
  uploadGymLogo,
} from "@/services/gym-settings";
import {
  connectGymPaymentCredentials,
  disconnectGymPaymentCredentials,
  getGymPaymentConnectionStatus,
  maskBusinessId,
  type GymPaymentConnectionStatus,
} from "@/services/gym-payment-credentials";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getServerTranslation } from "@/lib/i18n/get-server-translation";
import { TARAMONEY_PROVIDER_KEY } from "@/lib/featureFlags";

/** AD-13 Settings save. `{data,error}` contract, never throws for expected
 * errors -- matches `editTier`'s established Process Pattern. An audit-log
 * write failure doesn't fail the save (the setting itself did persist), so
 * it's surfaced via the separate `warning` field rather than `error` -- a
 * caller doing the conventional `if (error) return` must not silently
 * discard a save that actually succeeded. */
export async function saveGymSettings(
  input: unknown,
): Promise<{ data: { ok: true } | null; error: AppError | null; warning: string | null }> {
  const { t } = await getServerTranslation(await getRequestLocale());
  const parsed = gymSettingsSchema.safeParse(input);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    return {
      data: null,
      error: { code: "validation_error", message: firstIssue?.message ?? t("common.invalidInput") },
      warning: null,
    };
  }

  const { error } = await updateGymSettings(parsed.data);
  if (error) {
    return { data: null, error, warning: null };
  }

  const { error: auditError } = await logGymSettingsChange("gym_settings_updated", {
    gym_name: parsed.data.gymName,
    primary_color: parsed.data.primaryColor,
    timezone: parsed.data.timezone,
    default_language: parsed.data.defaultLanguage,
    grace_period_days: parsed.data.gracePeriodDays,
    capacity: parsed.data.capacity,
    alert_auto_dismiss_minutes: parsed.data.alertAutoDismissMinutes,
    checkin_timeout_hours: parsed.data.checkinTimeoutHours,
  });

  return {
    data: { ok: true },
    error: null,
    warning: auditError ? t("settings.errors.auditLogFailedSave") : null,
  };
}

/** Server Actions never trust client input (architecture's Process
 * Patterns) -- type/size are re-validated here even though the client
 * already gates the file picker to `image/*`. `uploadGymLogo` itself
 * re-validates type/size too, so a direct caller of the service function is
 * covered even without going through this Server Action. */
export async function uploadLogo(
  formData: FormData,
): Promise<{ data: { logoUrl: string } | null; error: AppError | null }> {
  const { t } = await getServerTranslation(await getRequestLocale());
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return { data: null, error: { code: "validation_error", message: t("settings.errors.noFileProvided") } };
  }
  if (!ALLOWED_LOGO_MIME_TYPES.has(file.type)) {
    return {
      data: null,
      error: { code: "validation_error", message: t("settings.errors.unsupportedType") },
    };
  }
  if (file.size === 0 || file.size > MAX_LOGO_BYTES) {
    return {
      data: null,
      error: { code: "validation_error", message: t("settings.errors.imageTooLarge") },
    };
  }

  return uploadGymLogo(file);
}

/** No input to validate, and no confirmation logic here -- the confirmation
 * dialog is a pure client-side UI gate (SettingsForm); this action executes
 * unconditionally once called. Same `warning`-vs-`error` split as
 * `saveGymSettings` -- the token itself did regenerate even if the audit
 * write failed. */
export async function regenerateQrCode(): Promise<{
  data: { gymToken: string } | null;
  error: AppError | null;
  warning: string | null;
}> {
  const { t } = await getServerTranslation(await getRequestLocale());
  const { data, error } = await regenerateQrCodeRow();
  if (error || !data) {
    return { data: null, error, warning: null };
  }

  const { error: auditError } = await logGymSettingsChange("gym_qr_code_regenerated", {});

  return {
    data,
    error: null,
    warning: auditError ? t("settings.errors.auditLogFailedQr") : null,
  };
}

/** Story 4.13: "Connect payment account". `connect_gym_payment_credentials()`
 * itself enforces owner-only/own-gym (never trusts a client-supplied gym
 * id), so this action's only responsibility is parsing input first, matching
 * `saveGymSettings`'s pattern. Upserts -- also used for "Reconnect". Returns
 * the freshly re-fetched masked status (never the raw credentials, NFR-017)
 * so the UI doesn't have to re-derive the mask client-side. */
export async function connectPaymentProvider(
  input: unknown,
): Promise<{ data: { status: GymPaymentConnectionStatus } | null; error: AppError | null }> {
  const { t } = await getServerTranslation(await getRequestLocale());
  const parsed = connectGymPaymentCredentialsSchema.safeParse(input);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    return {
      data: null,
      error: { code: "validation_error", message: firstIssue?.message ?? t("common.invalidInput") },
    };
  }

  const { error } = await connectGymPaymentCredentials(TARAMONEY_PROVIDER_KEY, parsed.data);
  if (error) {
    return { data: null, error };
  }

  const { data: status, error: statusError } = await getGymPaymentConnectionStatus(TARAMONEY_PROVIDER_KEY);
  if (statusError || !status) {
    // Review fix (Story 4.13): the credentials write above already
    // succeeded -- a failed re-read must never be reported as a connect
    // failure (the Owner would retry a connect that already happened).
    // Fall back to a status derived from what was just submitted, masked
    // the same way the DB would have.
    return {
      data: {
        status: { businessIdMasked: maskBusinessId(parsed.data.businessId), connectedAt: new Date().toISOString() },
      },
      error: null,
    };
  }
  return { data: { status }, error: null };
}

/** Story 4.13: "Disconnect payment account". No input to validate --
 * idempotent no-op at the RPC level if already disconnected, matching
 * `regenerateQrCode`'s "no confirmation logic here, the dialog is a pure
 * client-side gate" pattern. */
export async function disconnectPaymentProvider(): Promise<{
  data: { ok: true } | null;
  error: AppError | null;
}> {
  const { error } = await disconnectGymPaymentCredentials(TARAMONEY_PROVIDER_KEY);
  if (error) {
    return { data: null, error };
  }
  return { data: { ok: true }, error: null };
}
