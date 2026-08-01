"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import QRCode from "qrcode";
import { gymSettingsSchema } from "@gymos/types";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { GymSettingsRow } from "@/services/gym-settings";
import { regenerateQrCode, saveGymSettings, uploadLogo } from "./actions";

const TIMEZONE_OPTIONS = [
  { value: "Africa/Douala", label: "Africa/Douala (GMT+1)" },
  { value: "Africa/Lagos", label: "Africa/Lagos (GMT+1)" },
  { value: "Africa/Bangui", label: "Africa/Bangui (GMT+1)" },
  { value: "Africa/Kinshasa", label: "Africa/Kinshasa (GMT+1)" },
  { value: "UTC", label: "UTC" },
] as const;

const HEX_COLOR_RE = /^#[0-9A-Fa-f]{6}$/;

interface FieldErrors {
  gymName?: string;
  primaryColor?: string;
  timezone?: string;
  defaultLanguage?: string;
  gracePeriodDays?: string;
  capacity?: string;
  alertAutoDismissMinutes?: string;
  checkinTimeoutHours?: string;
}

export function SettingsForm({ initial }: { initial: GymSettingsRow }) {
  const { t } = useTranslation();

  const NAN_FIELD_MESSAGE_KEYS: Partial<Record<keyof FieldErrors, string>> = {
    gracePeriodDays: "settings.errors.gracePeriodRange",
    capacity: "settings.errors.capacityRequired",
    alertAutoDismissMinutes: "settings.errors.alertAutoDismissRange",
    checkinTimeoutHours: "settings.errors.checkinTimeoutRange",
  };

  const [form, setForm] = useState({
    gymName: initial.gymName,
    primaryColor: initial.primaryColor ?? "",
    timezone: initial.timezone,
    defaultLanguage: initial.defaultLanguage,
    gracePeriodDays: String(initial.gracePeriodDays),
    capacity: initial.capacity === null ? "" : String(initial.capacity),
    alertAutoDismissMinutes: String(initial.alertAutoDismissMinutes),
    checkinTimeoutHours: String(initial.checkinTimeoutHours),
  });
  // Swatch only updates on a *valid* hex value (Task 7's manual verification
  // spec: "swatch updates only on valid input") -- kept separate from the
  // raw `form.primaryColor` field so an in-progress, still-invalid keystroke
  // doesn't blank the swatch.
  const [swatchColor, setSwatchColor] = useState(
    initial.primaryColor && HEX_COLOR_RE.test(initial.primaryColor) ? initial.primaryColor : null,
  );

  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const formTopRef = useRef<HTMLDivElement>(null);

  const [logoUrl, setLogoUrl] = useState<string | null>(initial.logoUrl);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const logoBlobUrlRef = useRef<string | null>(null);

  const [gymToken, setGymToken] = useState(initial.gymToken);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [regenerateOpen, setRegenerateOpen] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const regenerateDialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      if (logoBlobUrlRef.current) URL.revokeObjectURL(logoBlobUrlRef.current);
    };
  }, []);

  useEffect(() => {
    if (regenerateOpen) {
      regenerateDialogRef.current?.showModal();
    }
  }, [regenerateOpen]);

  useEffect(() => {
    QRCode.toDataURL(gymToken).then(setQrDataUrl).catch(() => setQrDataUrl(null));
  }, [gymToken]);

  function showToast(message: string) {
    setToast(message);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 4000);
  }

  function handleColorChange(value: string) {
    setForm({ ...form, primaryColor: value });
    if (HEX_COLOR_RE.test(value)) {
      setSwatchColor(value);
    }
  }

  async function handleLogoSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setLogoError(null);
    if (logoBlobUrlRef.current) {
      URL.revokeObjectURL(logoBlobUrlRef.current);
    }
    // The URL this upload should fall back to if it fails -- whatever was
    // showing before this attempt, not necessarily `initial.logoUrl` (a
    // prior successful upload in this same session may have already moved
    // it away from the initial value).
    const previousLogoUrl = logoUrl;
    // Client-side preview, before any server round-trip -- this is what
    // satisfies AC #1's "immediately" wording (story Dev Notes).
    const blobUrl = URL.createObjectURL(file);
    logoBlobUrlRef.current = blobUrl;
    setLogoUrl(blobUrl);
    setUploadingLogo(true);

    try {
      const formData = new FormData();
      formData.set("file", file);
      const { data, error } = await uploadLogo(formData);
      if (error) {
        setLogoError(error.message);
        URL.revokeObjectURL(blobUrl);
        logoBlobUrlRef.current = null;
        setLogoUrl(previousLogoUrl);
        return;
      }
      if (data) {
        URL.revokeObjectURL(blobUrl);
        logoBlobUrlRef.current = null;
        setLogoUrl(data.logoUrl);
      }
    } catch {
      setLogoError(t("common.somethingWentWrong"));
      URL.revokeObjectURL(blobUrl);
      logoBlobUrlRef.current = null;
      setLogoUrl(previousLogoUrl);
    } finally {
      setUploadingLogo(false);
    }
  }

  function handleRemoveLogo() {
    if (logoBlobUrlRef.current) {
      URL.revokeObjectURL(logoBlobUrlRef.current);
      logoBlobUrlRef.current = null;
    }
    setLogoUrl(null);
    setLogoError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); // validate on submit only, per UX-DR11
    setFieldErrors({});
    setFormError(null);

    const candidate = {
      gymName: form.gymName,
      logoUrl,
      // Schema accepts null (no color set yet) but not an empty string --
      // an untouched/cleared field submits as "no color" rather than
      // tripping the hex-format validation.
      primaryColor: form.primaryColor.trim() === "" ? null : form.primaryColor,
      timezone: form.timezone,
      defaultLanguage: form.defaultLanguage,
      gracePeriodDays: Number(form.gracePeriodDays),
      capacity: Number(form.capacity),
      alertAutoDismissMinutes: Number(form.alertAutoDismissMinutes),
      checkinTimeoutHours: Number(form.checkinTimeoutHours),
    };

    const parsed = gymSettingsSchema.safeParse(candidate);
    if (!parsed.success) {
      const errors: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0] as keyof FieldErrors;
        if (!errors[field]) errors[field] = issue.message;
      }
      // `Number("-")`/`Number("")` produce NaN, which Zod reports with a
      // generic "expected number, received nan" message instead of the
      // field's tailored copy -- substitute it back in for exactly that case.
      for (const field of ["gracePeriodDays", "capacity", "alertAutoDismissMinutes", "checkinTimeoutHours"] as const) {
        if (Number.isNaN(candidate[field])) {
          errors[field] = t(NAN_FIELD_MESSAGE_KEYS[field]!);
        }
      }
      setFieldErrors(errors);
      const firstErrorField = Object.keys(errors)[0];
      const target = firstErrorField ? document.getElementById(firstErrorField) : null;
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "center" });
      } else {
        formTopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
      return;
    }

    setSubmitting(true);
    try {
      const { error, warning } = await saveGymSettings(parsed.data);
      if (error) {
        setFormError(error.message);
        return;
      }
      showToast(warning ?? t("settings.savedToast"));
    } catch {
      setFormError(t("common.somethingWentWrong"));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRegenerateConfirm() {
    setRegenerating(true);
    try {
      const { data, error, warning } = await regenerateQrCode();
      if (error || !data) {
        showToast(t("settings.qr.regenerateFailedToast"));
        return;
      }
      setGymToken(data.gymToken);
      if (warning) {
        showToast(warning);
      }
    } catch {
      showToast(t("settings.qr.regenerateFailedToast"));
    } finally {
      setRegenerating(false);
      setRegenerateOpen(false);
    }
  }

  function handleDownloadQr() {
    if (!qrDataUrl) return;
    const link = document.createElement("a");
    link.href = qrDataUrl;
    link.download = "gym-qr-code.png";
    link.click();
  }

  return (
    <div ref={formTopRef} className="space-y-8">
      <form onSubmit={handleSubmit} className="space-y-8">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">{t("settings.saveHint")}</span>
          <Button type="submit" disabled={submitting || uploadingLogo}>
            {submitting ? t("common.saving") : t("settings.saveButton")}
          </Button>
        </div>

        <section className="space-y-4 rounded-md border p-4">
          <h2 className="font-semibold">{t("settings.sections.branding")}</h2>

          <div className="space-y-2">
            <Label htmlFor="gymName">{t("settings.fields.gymName")}</Label>
            <Input
              id="gymName"
              value={form.gymName}
              onChange={(e) => setForm({ ...form, gymName: e.target.value })}
            />
            {fieldErrors.gymName && <p className="text-sm text-red-600">{fieldErrors.gymName}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="logo">{t("settings.fields.logo")}</Label>
            <div className="flex items-center gap-3">
              {logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={logoUrl}
                  alt={t("settings.fields.logoPreviewAlt")}
                  className="size-16 rounded-md border object-cover"
                />
              ) : (
                <div className="flex size-16 items-center justify-center rounded-md border text-xs text-muted-foreground">
                  {t("settings.fields.noLogo")}
                </div>
              )}
              <Button type="button" variant="outline" size="sm" asChild>
                <label htmlFor="logo" className="cursor-pointer">
                  {uploadingLogo ? t("settings.fields.uploading") : t("settings.fields.uploadNew")}
                </label>
              </Button>
              <input
                id="logo"
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="hidden"
                onChange={handleLogoSelect}
              />
              <Button type="button" variant="outline" size="sm" onClick={handleRemoveLogo}>
                {t("settings.fields.remove")}
              </Button>
            </div>
            {logoError && <p className="text-sm text-red-600">{logoError}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="primaryColor">{t("settings.fields.primaryColor")}</Label>
            <div className="flex items-center gap-3">
              <Input
                id="primaryColor"
                value={form.primaryColor}
                onChange={(e) => handleColorChange(e.target.value)}
                placeholder="#E0971F"
                className="max-w-40"
              />
              <div
                className="size-9 rounded-md border"
                style={{ backgroundColor: swatchColor ?? "transparent" }}
                aria-hidden="true"
              />
            </div>
            {fieldErrors.primaryColor && (
              <p className="text-sm text-red-600">{fieldErrors.primaryColor}</p>
            )}
          </div>
        </section>

        <section className="space-y-4 rounded-md border p-4">
          <h2 className="font-semibold">{t("settings.sections.localization")}</h2>

          <div className="space-y-2">
            <Label htmlFor="defaultLanguage">{t("settings.fields.defaultLanguage")}</Label>
            <select
              id="defaultLanguage"
              value={form.defaultLanguage}
              onChange={(e) => setForm({ ...form, defaultLanguage: e.target.value })}
              className="flex h-9 w-full max-w-xs rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <option value="en">{t("settings.languageOptionEnglish")}</option>
              <option value="fr">{t("settings.languageOptionFrench")}</option>
            </select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="timezone">{t("settings.fields.timezone")}</Label>
            <select
              id="timezone"
              value={form.timezone}
              onChange={(e) => setForm({ ...form, timezone: e.target.value })}
              className="flex h-9 w-full max-w-xs rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              {TIMEZONE_OPTIONS.map((tz) => (
                <option key={tz.value} value={tz.value}>
                  {tz.label}
                </option>
              ))}
            </select>
            {fieldErrors.timezone && <p className="text-sm text-red-600">{fieldErrors.timezone}</p>}
          </div>
        </section>

        <section className="space-y-4 rounded-md border p-4">
          <h2 className="font-semibold">{t("settings.sections.membership")}</h2>

          <div className="space-y-2">
            <Label htmlFor="gracePeriodDays">{t("settings.fields.gracePeriod")}</Label>
            <div className="flex max-w-40 items-center gap-2">
              <Input
                id="gracePeriodDays"
                type="number"
                value={form.gracePeriodDays}
                onChange={(e) => setForm({ ...form, gracePeriodDays: e.target.value })}
              />
              <span className="text-sm text-muted-foreground">{t("settings.fields.gracePeriodUnit")}</span>
            </div>
            {fieldErrors.gracePeriodDays && (
              <p className="text-sm text-red-600">{fieldErrors.gracePeriodDays}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="capacity">{t("settings.fields.capacity")}</Label>
            <div className="flex max-w-40 items-center gap-2">
              <Input
                id="capacity"
                type="number"
                value={form.capacity}
                onChange={(e) => setForm({ ...form, capacity: e.target.value })}
              />
              <span className="text-sm text-muted-foreground">{t("settings.fields.capacityUnit")}</span>
            </div>
            {fieldErrors.capacity && <p className="text-sm text-red-600">{fieldErrors.capacity}</p>}
          </div>
        </section>

        <section className="space-y-4 rounded-md border p-4">
          <h2 className="font-semibold">{t("settings.sections.attendance")}</h2>

          <div className="space-y-2">
            <Label htmlFor="checkinTimeoutHours">{t("settings.fields.checkinTimeout")}</Label>
            <div className="flex max-w-40 items-center gap-2">
              <Input
                id="checkinTimeoutHours"
                type="number"
                value={form.checkinTimeoutHours}
                onChange={(e) =>
                  setForm({ ...form, checkinTimeoutHours: e.target.value })
                }
              />
              <span className="text-sm text-muted-foreground">
                {t("settings.fields.checkinTimeoutUnit")}
              </span>
            </div>
            {fieldErrors.checkinTimeoutHours && (
              <p className="text-sm text-red-600">{fieldErrors.checkinTimeoutHours}</p>
            )}
          </div>
        </section>

        <section className="space-y-4 rounded-md border p-4">
          <h2 className="font-semibold">{t("settings.sections.frontDeskAlerts")}</h2>

          <div className="space-y-2">
            <Label htmlFor="alertAutoDismissMinutes">{t("settings.fields.alertAutoDismiss")}</Label>
            <div className="flex max-w-40 items-center gap-2">
              <Input
                id="alertAutoDismissMinutes"
                type="number"
                value={form.alertAutoDismissMinutes}
                onChange={(e) =>
                  setForm({ ...form, alertAutoDismissMinutes: e.target.value })
                }
              />
              <span className="text-sm text-muted-foreground">
                {t("settings.fields.alertAutoDismissUnit")}
              </span>
            </div>
            {fieldErrors.alertAutoDismissMinutes && (
              <p className="text-sm text-red-600">{fieldErrors.alertAutoDismissMinutes}</p>
            )}
          </div>
        </section>

        {formError && <p className="text-sm text-red-600">{formError}</p>}
      </form>

      <section className="space-y-4 rounded-md border p-4">
        <h2 className="font-semibold">{t("settings.sections.qrCode")}</h2>
        {qrDataUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={qrDataUrl} alt={t("settings.qr.qrCodeAlt")} className="size-[120px]" />
        )}
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={handleDownloadQr}>
            {t("settings.qr.download")}
          </Button>
          <Button type="button" variant="outline" onClick={() => setRegenerateOpen(true)}>
            {t("settings.qr.regenerate")}
          </Button>
        </div>
      </section>

      <dialog
        ref={regenerateDialogRef}
        onClose={() => setRegenerateOpen(false)}
        onCancel={(e) => {
          if (regenerating) e.preventDefault();
        }}
        className="w-full max-w-[420px] rounded-md border bg-background p-0 text-foreground backdrop:bg-black/50"
      >
        <div className="space-y-4 p-6">
          <h2 className="text-lg font-semibold">{t("settings.qr.regenerateConfirmTitle")}</h2>
          <p className="text-sm text-muted-foreground">{t("settings.qr.regenerateConfirmBody")}</p>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={regenerating}
              onClick={() => regenerateDialogRef.current?.close()}
            >
              {t("common.cancel")}
            </Button>
            <Button type="button" disabled={regenerating} onClick={handleRegenerateConfirm}>
              {regenerating ? t("settings.qr.regenerating") : t("settings.qr.regenerate")}
            </Button>
          </div>
        </div>
      </dialog>

      {toast && (
        <div
          role="status"
          className="fixed bottom-4 right-4 rounded-md bg-primary px-4 py-3 text-sm text-primary-foreground shadow-lg"
        >
          {toast}
        </div>
      )}
    </div>
  );
}
