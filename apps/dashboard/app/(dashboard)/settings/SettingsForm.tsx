"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import QRCode from "qrcode";
import { Bell, Clock, CreditCard, Globe, Palette, QrCode, Users, type LucideIcon } from "lucide-react";
import { connectGymPaymentCredentialsSchema, gymSettingsSchema } from "@gymos/types";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { GymSettingsRow } from "@/services/gym-settings";
import type { GymPaymentConnectionStatus } from "@/services/gym-payment-credentials";
import {
  connectPaymentProvider,
  disconnectPaymentProvider,
  regenerateQrCode,
  saveGymSettings,
  uploadLogo,
} from "./actions";

// Tinted per-section icon treatment (each section gets its own accent so the
// grid reads as distinct categories at a glance, rather than one repeated
// muted-gray icon) -- deliberately independent of the gym's own configurable
// `primaryColor` brand color below, since these are fixed UI chrome, not
// tenant-branded surface.
const SECTION_ACCENTS = {
  violet: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
  blue: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  emerald: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  amber: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  cyan: "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400",
  rose: "bg-rose-500/10 text-rose-600 dark:text-rose-400",
  teal: "bg-teal-500/10 text-teal-600 dark:text-teal-400",
} as const;

function SectionHeader({
  icon: Icon,
  accent,
  title,
  description,
}: {
  icon: LucideIcon;
  accent: keyof typeof SECTION_ACCENTS;
  title: string;
  description: string;
}) {
  return (
    <CardHeader className="flex-row items-center gap-3 space-y-0">
      <div className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${SECTION_ACCENTS[accent]}`}>
        <Icon className="size-4.5" aria-hidden="true" />
      </div>
      <div className="space-y-0.5">
        <CardTitle role="heading" aria-level={2} className="text-base">
          {title}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </div>
    </CardHeader>
  );
}

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

interface PaymentFieldErrors {
  apiKey?: string;
  businessId?: string;
  webhookSecret?: string;
}

// Review fix (Story 4.13): `connectGymPaymentCredentialsSchema`'s Zod
// messages are English-only and were previously shown to the user verbatim,
// bypassing i18n entirely despite Task 4's explicit requirement for
// localized dialog errors. Mapped by field + issue code instead, matching
// this file's own `NAN_FIELD_MESSAGE_KEYS` precedent for the main form.
const PAYMENT_FIELD_MESSAGE_KEYS: Record<keyof PaymentFieldErrors, { required: string; tooLong: string }> = {
  apiKey: {
    required: "settings.payments.apiKeyRequiredError",
    tooLong: "settings.payments.apiKeyTooLongError",
  },
  businessId: {
    required: "settings.payments.businessIdRequiredError",
    tooLong: "settings.payments.businessIdTooLongError",
  },
  webhookSecret: {
    required: "settings.payments.webhookSecretRequiredError",
    tooLong: "settings.payments.webhookSecretTooLongError",
  },
};

export function SettingsForm({
  initial,
  initialPaymentConnection,
}: {
  initial: GymSettingsRow;
  initialPaymentConnection: GymPaymentConnectionStatus | null;
}) {
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

  const [paymentConnection, setPaymentConnection] = useState(initialPaymentConnection);
  const [paymentForm, setPaymentForm] = useState({ apiKey: "", businessId: "", webhookSecret: "" });
  const [paymentFieldErrors, setPaymentFieldErrors] = useState<PaymentFieldErrors>({});
  const [paymentFormError, setPaymentFormError] = useState<string | null>(null);
  const [connectOpen, setConnectOpen] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const connectDialogRef = useRef<HTMLDialogElement>(null);
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const disconnectDialogRef = useRef<HTMLDialogElement>(null);

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
    if (connectOpen) {
      connectDialogRef.current?.showModal();
    }
  }, [connectOpen]);

  useEffect(() => {
    if (disconnectOpen) {
      disconnectDialogRef.current?.showModal();
    }
  }, [disconnectOpen]);

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

  function openConnectDialog() {
    setPaymentForm({ apiKey: "", businessId: "", webhookSecret: "" });
    setPaymentFieldErrors({});
    setPaymentFormError(null);
    setConnectOpen(true);
  }

  async function handleConnectSubmit(e: React.FormEvent) {
    e.preventDefault();
    // Review fix (Story 4.13): the submit button's `disabled` prop is the
    // primary guard, but the handler itself didn't check -- a second Enter
    // keypress before React re-renders could reach this twice concurrently.
    if (connecting) return;
    setPaymentFieldErrors({});
    setPaymentFormError(null);

    const parsed = connectGymPaymentCredentialsSchema.safeParse(paymentForm);
    if (!parsed.success) {
      const errors: PaymentFieldErrors = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0] as keyof PaymentFieldErrors;
        if (!errors[field]) {
          const keys = PAYMENT_FIELD_MESSAGE_KEYS[field];
          errors[field] = t(issue.code === "too_big" ? keys.tooLong : keys.required);
        }
      }
      setPaymentFieldErrors(errors);
      return;
    }

    setConnecting(true);
    try {
      const { data, error } = await connectPaymentProvider(parsed.data);
      if (error || !data) {
        setPaymentFormError(error?.message ?? t("common.somethingWentWrong"));
        return;
      }
      setPaymentConnection(data.status);
      // Review fix (Story 4.13): `setConnectOpen(false)` alone doesn't close
      // the native <dialog> opened via showModal() -- only the Cancel button
      // and Escape key did, via the onClose handler below. Without this, the
      // modal stayed visually open (still blocking the page) after a
      // successful connect.
      connectDialogRef.current?.close();
      setConnectOpen(false);
      showToast(t("settings.payments.connectedToast"));
    } catch {
      setPaymentFormError(t("common.somethingWentWrong"));
    } finally {
      setConnecting(false);
    }
  }

  async function handleDisconnectConfirm() {
    setDisconnecting(true);
    try {
      const { error } = await disconnectPaymentProvider();
      if (error) {
        showToast(t("settings.payments.disconnectFailedToast"));
        return;
      }
      setPaymentConnection(null);
      showToast(t("settings.payments.disconnectedToast"));
    } catch {
      showToast(t("settings.payments.disconnectFailedToast"));
    } finally {
      // Review fix (Story 4.13): same dialog-not-actually-closed gap as
      // handleConnectSubmit above, on both the success and failure paths.
      disconnectDialogRef.current?.close();
      setDisconnecting(false);
      setDisconnectOpen(false);
    }
  }


  return (
    <div ref={formTopRef} className="space-y-6">
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="flex items-center justify-between rounded-md border bg-muted/40 px-4 py-3">
          <span className="text-sm text-muted-foreground">{t("settings.saveHint")}</span>
          <Button type="submit" disabled={submitting || uploadingLogo}>
            {submitting ? t("common.saving") : t("settings.saveButton")}
          </Button>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:items-start">
          {/* Left column: the two visual, identity-heavy sections -- QR code
              is the thing gyms actually print/display, so it leads big, with
              its actions stacked below rather than squeezed beside it. */}
          <div className="space-y-6">
            <Card>
              <SectionHeader
                icon={QrCode}
                accent="blue"
                title={t("settings.sections.qrCode")}
                description={t("settings.sectionDescriptions.qrCode")}
              />
              <CardContent className="flex flex-col items-center gap-5">
                {qrDataUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={qrDataUrl}
                    alt={t("settings.qr.qrCodeAlt")}
                    className="h-auto w-full max-w-[280px] rounded-md border p-3"
                  />
                )}
                <div className="flex w-full max-w-[280px] flex-col gap-2">
                  <Button type="button" variant="outline" className="w-full" onClick={handleDownloadQr}>
                    {t("settings.qr.download")}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full"
                    onClick={() => setRegenerateOpen(true)}
                  >
                    {t("settings.qr.regenerate")}
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <SectionHeader
                icon={Palette}
                accent="violet"
                title={t("settings.sections.branding")}
                description={t("settings.sectionDescriptions.branding")}
              />
              <CardContent className="space-y-5">
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
                  <div className="flex items-center gap-4">
                    {logoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={logoUrl}
                        alt={t("settings.fields.logoPreviewAlt")}
                        className="size-24 rounded-md border object-cover"
                      />
                    ) : (
                      <div className="flex size-24 items-center justify-center rounded-md border text-xs text-muted-foreground">
                        {t("settings.fields.noLogo")}
                      </div>
                    )}
                    <div className="flex flex-col gap-1.5">
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
                      className="size-9 shrink-0 rounded-md border"
                      style={{ backgroundColor: swatchColor ?? "transparent" }}
                      aria-hidden="true"
                    />
                  </div>
                  {fieldErrors.primaryColor && (
                    <p className="text-sm text-red-600">{fieldErrors.primaryColor}</p>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Right column: the smaller, numeric-field settings -- naturally
              more compact, so they read fine stacked in a narrower column
              rather than each claiming a full-width row of their own. */}
          <div className="space-y-6">
            <Card>
              <SectionHeader
                icon={Globe}
                accent="emerald"
                title={t("settings.sections.localization")}
                description={t("settings.sectionDescriptions.localization")}
              />
              <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="defaultLanguage">{t("settings.fields.defaultLanguage")}</Label>
                  <select
                    id="defaultLanguage"
                    value={form.defaultLanguage}
                    onChange={(e) => setForm({ ...form, defaultLanguage: e.target.value })}
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
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
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    {TIMEZONE_OPTIONS.map((tz) => (
                      <option key={tz.value} value={tz.value}>
                        {tz.label}
                      </option>
                    ))}
                  </select>
                  {fieldErrors.timezone && <p className="text-sm text-red-600">{fieldErrors.timezone}</p>}
                </div>
              </CardContent>
            </Card>

            <Card>
              <SectionHeader
                icon={Users}
                accent="amber"
                title={t("settings.sections.membership")}
                description={t("settings.sectionDescriptions.membership")}
              />
              <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="gracePeriodDays">{t("settings.fields.gracePeriod")}</Label>
                  <div className="flex items-center gap-2">
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
                  <div className="flex items-center gap-2">
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
              </CardContent>
            </Card>

            <Card>
              <SectionHeader
                icon={Clock}
                accent="cyan"
                title={t("settings.sections.attendance")}
                description={t("settings.sectionDescriptions.attendance")}
              />
              <CardContent>
                <div className="max-w-xs space-y-2">
                  <Label htmlFor="checkinTimeoutHours">{t("settings.fields.checkinTimeout")}</Label>
                  <div className="flex items-center gap-2">
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
              </CardContent>
            </Card>

            <Card>
              <SectionHeader
                icon={Bell}
                accent="rose"
                title={t("settings.sections.frontDeskAlerts")}
                description={t("settings.sectionDescriptions.frontDeskAlerts")}
              />
              <CardContent>
                <div className="max-w-xs space-y-2">
                  <Label htmlFor="alertAutoDismissMinutes">{t("settings.fields.alertAutoDismiss")}</Label>
                  <div className="flex items-center gap-2">
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
              </CardContent>
            </Card>

            <Card>
              <SectionHeader
                icon={CreditCard}
                accent="teal"
                title={t("settings.sections.payments")}
                description={t("settings.sectionDescriptions.payments")}
              />
              <CardContent>
                {paymentConnection ? (
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="text-sm">
                      <p className="font-medium">
                        {t("settings.payments.connectedLabel", { businessId: paymentConnection.businessIdMasked })}
                      </p>
                      <p className="text-muted-foreground">
                        {t("settings.payments.connectedSince", {
                          date: new Date(paymentConnection.connectedAt).toLocaleDateString(),
                        })}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button type="button" variant="outline" size="sm" onClick={openConnectDialog}>
                        {t("settings.payments.reconnect")}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setDisconnectOpen(true)}
                      >
                        {t("settings.payments.disconnect")}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-sm text-muted-foreground">{t("settings.payments.notConnected")}</p>
                    <Button type="button" variant="outline" size="sm" onClick={openConnectDialog}>
                      {t("settings.payments.connect")}
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>

        {formError && <p className="text-sm text-red-600">{formError}</p>}
      </form>

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

      <dialog
        ref={connectDialogRef}
        onClose={() => setConnectOpen(false)}
        onCancel={(e) => {
          if (connecting) e.preventDefault();
        }}
        className="w-full max-w-[440px] rounded-md border bg-background p-0 text-foreground backdrop:bg-black/50"
      >
        <form onSubmit={handleConnectSubmit} className="space-y-4 p-6">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold">{t("settings.payments.connectDialogTitle")}</h2>
            <p className="text-sm text-muted-foreground">{t("settings.payments.connectDialogBody")}</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="paymentApiKey">{t("settings.payments.apiKeyLabel")}</Label>
            <Input
              id="paymentApiKey"
              type="password"
              autoComplete="off"
              value={paymentForm.apiKey}
              onChange={(e) => setPaymentForm({ ...paymentForm, apiKey: e.target.value })}
            />
            {paymentFieldErrors.apiKey && <p className="text-sm text-red-600">{paymentFieldErrors.apiKey}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="paymentBusinessId">{t("settings.payments.businessIdLabel")}</Label>
            <Input
              id="paymentBusinessId"
              value={paymentForm.businessId}
              onChange={(e) => setPaymentForm({ ...paymentForm, businessId: e.target.value })}
            />
            {paymentFieldErrors.businessId && (
              <p className="text-sm text-red-600">{paymentFieldErrors.businessId}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="paymentWebhookSecret">{t("settings.payments.webhookSecretLabel")}</Label>
            <Input
              id="paymentWebhookSecret"
              type="password"
              autoComplete="off"
              value={paymentForm.webhookSecret}
              onChange={(e) => setPaymentForm({ ...paymentForm, webhookSecret: e.target.value })}
            />
            {paymentFieldErrors.webhookSecret && (
              <p className="text-sm text-red-600">{paymentFieldErrors.webhookSecret}</p>
            )}
          </div>

          {paymentFormError && <p className="text-sm text-red-600">{paymentFormError}</p>}

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={connecting}
              onClick={() => connectDialogRef.current?.close()}
            >
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={connecting}>
              {connecting ? t("settings.payments.connecting") : t("settings.payments.connect")}
            </Button>
          </div>
        </form>
      </dialog>

      <dialog
        ref={disconnectDialogRef}
        onClose={() => setDisconnectOpen(false)}
        onCancel={(e) => {
          if (disconnecting) e.preventDefault();
        }}
        className="w-full max-w-[420px] rounded-md border bg-background p-0 text-foreground backdrop:bg-black/50"
      >
        <div className="space-y-4 p-6">
          <h2 className="text-lg font-semibold">{t("settings.payments.disconnectConfirmTitle")}</h2>
          <p className="text-sm text-muted-foreground">{t("settings.payments.disconnectConfirmBody")}</p>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={disconnecting}
              onClick={() => disconnectDialogRef.current?.close()}
            >
              {t("common.cancel")}
            </Button>
            <Button type="button" variant="destructive" disabled={disconnecting} onClick={handleDisconnectConfirm}>
              {disconnecting ? t("settings.payments.disconnecting") : t("settings.payments.disconnect")}
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
