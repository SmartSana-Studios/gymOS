"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { gymSettingsSchema } from "@gymos/types";

import { Button } from "@/components/ui/button";
import type { GymSettingsRow } from "@/services/gym-settings";
import type { GymPaymentConnectionStatus } from "@/services/gym-payment-credentials";
import type { GymBillingInfo, SelectableTier } from "@/services/billing";
import { listPhoneCountries } from "@/lib/phone";
import { type LoyaltyPlanDuration } from "./loyaltyReadout";
import { LoyaltyProgramSection } from "./LoyaltyProgramSection";
import { saveGymSettings } from "./actions";
import { AttendanceSection } from "./AttendanceSection";
import { BillingSection } from "./BillingSection";
import { BrandingSection } from "./BrandingSection";
import { FrontDeskAlertsSection } from "./FrontDeskAlertsSection";
import { GuestChargingDialogs, useGuestCharging } from "./GuestChargingSection";
import { LocalizationSection } from "./LocalizationSection";
import { MembershipSection } from "./MembershipSection";
import { PaymentDialogs, PaymentsCard, usePayments } from "./PaymentsSection";
import { QrCodeCard, QrRegenerateDialog, useQrCode } from "./QrCodeSection";
import { StaffSection } from "./StaffSection";
import { GymosSupportSection } from "./GymosSupportSection";
import type { GymosSupportStatus } from "@/services/gym-settings";
import type { FieldErrors } from "./settingsFormTypes";
import { useLogoUpload } from "./useLogoUpload";

export function SettingsForm({
  initial,
  initialPaymentConnection,
  initialBillingInfo,
  selectableTiers,
  staffCount,
  role = null,
  loyaltyEnabled,
  loyaltyPlans = [],
  gymosSupportStatus = null,
}: {
  initial: GymSettingsRow;
  initialPaymentConnection: GymPaymentConnectionStatus | null;
  initialBillingInfo: GymBillingInfo | null;
  selectableTiers: SelectableTier[];
  staffCount: number;
  /** Story 19.9a: the caller's role; the charge-guests control renders only for owner/supervisor. */
  role?: string | null;
  /** Story 19.9a: adds the "stop earning stamps" clause to the turn-off dialog. Story 20.5: when
   * omitted, the saved gym value (kept in sync after a loyalty save) is used. */
  loyaltyEnabled?: boolean;
  /** Story 20.5: the gym's non-pay-per-session plans, for the subscriber discount readout. */
  loyaltyPlans?: LoyaltyPlanDuration[];
  /** Story 23.3: the Owner-only GymOS Support readout; null for any other role (the section is not rendered). */
  gymosSupportStatus?: GymosSupportStatus | null;
}) {
  const { t, i18n } = useTranslation();
  const countryOptions = useMemo(() => listPhoneCountries(i18n.language), [i18n.language]);

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
    country: initial.country,
    gracePeriodDays: String(initial.gracePeriodDays),
    capacity: initial.capacity === null ? "" : String(initial.capacity),
    alertAutoDismissMinutes: String(initial.alertAutoDismissMinutes),
    checkinTimeoutHours: String(initial.checkinTimeoutHours),
  });

  // Story 19.9a: the charge-guests control, the loyalty program and the
  // category field render for owner/supervisor only.
  const canManageGuestCharging = role === "owner" || role === "supervisor" || role === "support";
  const canManageCategory = role === "owner" || role === "supervisor" || role === "support";

  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const formTopRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  function showToast(message: string) {
    setToast(message);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 4000);
  }

  const logo = useLogoUpload(initial.logoUrl);
  const { logoUrl, uploadingLogo } = logo;
  const qr = useQrCode({ initialToken: initial.gymToken, showToast });
  const payments = usePayments({ initialConnection: initialPaymentConnection, showToast, isSupport: role === "support" });
  const charge = useGuestCharging({ initialValue: initial.chargeGuestsPerSession, showToast });
  // Story 20.5: mirrors the saved loyalty switch for the turn-off dialog; the section reports changes.
  const [loyaltyActive, setLoyaltyActive] = useState(initial.loyaltyEnabled);

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
      country: form.country,
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
          {/* Left column: identity and account -- QR code leads big (it is what
              gyms print/display), then branding, payment provider, SaaS
              billing and staff. */}
          <div className="space-y-6">
            <QrCodeCard qr={qr} />

            <BrandingSection
              form={form}
              setForm={setForm}
              fieldErrors={fieldErrors}
              logo={logo}
              canManageCategory={canManageCategory}
              initialCategory={initial.category}
              showToast={showToast}
            />

            <PaymentsCard payments={payments} />

            <BillingSection
              initialBillingInfo={initialBillingInfo}
              selectableTiers={selectableTiers}
              showToast={showToast}
            />

            <StaffSection staffCount={staffCount} />

            {role === "owner" && gymosSupportStatus && (
              <GymosSupportSection initial={gymosSupportStatus} onSaved={showToast} />
            )}
          </div>

          {/* Right column: how the gym operates -- localization, membership
              (fees, guest charging, loyalty), attendance and front desk
              alerts. */}
          <div className="space-y-6">
            <LocalizationSection
              form={form}
              setForm={setForm}
              fieldErrors={fieldErrors}
              countryOptions={countryOptions}
            />

            <MembershipSection
              form={form}
              setForm={setForm}
              fieldErrors={fieldErrors}
              initialFee={initial.registrationFee}
              canManageGuestCharging={canManageGuestCharging}
              charge={charge}
              showToast={showToast}
            />

            {canManageGuestCharging && (
              <LoyaltyProgramSection
                initial={{
                  enabled: initial.loyaltyEnabled,
                  n: initial.loyaltyGuestThreshold,
                  k: initial.loyaltyRenewalThreshold,
                  r: initial.loyaltyRewardDays,
                }}
                plans={loyaltyPlans}
                chargingOn={charge.chargeGuests}
                onSaved={showToast}
                onEnabledChange={setLoyaltyActive}
              />
            )}

            <AttendanceSection form={form} setForm={setForm} fieldErrors={fieldErrors} />

            <FrontDeskAlertsSection form={form} setForm={setForm} fieldErrors={fieldErrors} />
          </div>
        </div>

        {formError && <p className="text-sm text-red-600">{formError}</p>}
      </form>

      <QrRegenerateDialog qr={qr} />

      <PaymentDialogs payments={payments} />

      {canManageGuestCharging && (
        <GuestChargingDialogs charge={charge} loyaltyEnabled={loyaltyEnabled ?? loyaltyActive} />
      )}

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
