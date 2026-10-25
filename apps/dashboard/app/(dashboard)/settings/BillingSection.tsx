"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Receipt } from "lucide-react";
import { emailSchema } from "@gymos/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { type GymBillingInfo, type SelectableTier } from "@/services/billing";
import { PayNowButton } from "@/components/shared/PayNowButton";
import { SectionHeader } from "./SectionHeader";
import { getBillingInfo, saveNotificationEmail } from "./actions";

// Story 11.3 (review fix): `saas_billing_anchor_date` is a bare "YYYY-MM-DD"
// date column -- `new Date(dateOnly)` parses it as UTC midnight, which then
// renders a day early for a negative-UTC-offset viewer. Mirrors this exact
// codebase's own established fix (RenewalModal.tsx/MembersPageClient.tsx/
// CoachPortalPageClient.tsx/SubscriptionsPageClient.tsx/FrontDeskAlertPanel.tsx):
// build the Date from local Y/M/D components instead.
function formatLocalDate(dateOnly: string, locale: string): string {
  const [year, month, day] = dateOnly.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(locale);
}

export function BillingSection({
  initialBillingInfo,
  selectableTiers,
  showToast,
}: {
  initialBillingInfo: GymBillingInfo | null;
  selectableTiers: SelectableTier[];
  showToast: (message: string) => void;
}) {
  const { t, i18n } = useTranslation();
  // Story 11.3 (Task 6): the Owner's own GymOS (Flow B) billing section.
  const [billingInfo, setBillingInfo] = useState(initialBillingInfo);
  const [notificationEmail, setNotificationEmail] = useState(initialBillingInfo?.notificationEmail ?? "");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [savingEmail, setSavingEmail] = useState(false);

  async function handlePaymentConfirmed() {
    showToast(t("settings.billing.paymentConfirmedToast"));
    // Refetches this client component's own copy of billingInfo --
    // router.refresh() alone re-renders the Server Component tree, but this
    // component's local useState (seeded from initialBillingInfo) would not
    // pick that up without an explicit refetch, same as paymentConnection's
    // own established pattern.
    try {
      const { data } = await getBillingInfo();
      if (data) setBillingInfo(data);
    } catch (err) {
      console.error("[settings] failed to refetch billing info after payment confirmation", err);
    }
  }

  async function handleSaveNotificationEmail() {
    setEmailError(null);
    const trimmed = notificationEmail.trim();
    const parsed = emailSchema.safeParse(trimmed === "" ? null : trimmed);
    if (!parsed.success) {
      setEmailError(parsed.error.issues[0]?.message ?? t("common.invalidInput"));
      return;
    }
    setSavingEmail(true);
    try {
      const { error } = await saveNotificationEmail(parsed.data ?? null);
      if (error) {
        setEmailError(error.message);
        return;
      }
      setBillingInfo((current) => (current ? { ...current, notificationEmail: parsed.data ?? null } : current));
      showToast(t("settings.billing.emailSavedToast"));
    } catch {
      setEmailError(t("common.somethingWentWrong"));
    } finally {
      setSavingEmail(false);
    }
  }

  if (!billingInfo) return null;

  return (
      <Card>
        <SectionHeader
          icon={Receipt}
          accent="amber"
          title={t("settings.sections.billing")}
          description={t("settings.sectionDescriptions.billing")}
        />
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm">
              <p className="font-medium">
                {billingInfo.tierName} —{" "}
                {t(
                  billingInfo.interval === "annual"
                    ? "settings.billing.intervalAnnual"
                    : "settings.billing.intervalMonthly",
                )}
              </p>
              <p className="text-muted-foreground">
                {t("settings.billing.nextBillingDate", {
                  date: formatLocalDate(billingInfo.anchorDate, i18n.language),
                })}
              </p>
            </div>
            <span
              className={`w-fit rounded-full px-3 py-1 text-xs font-medium ${
                billingInfo.billingStatus === "active"
                  ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                  : billingInfo.billingStatus === "suspended"
                    ? "bg-red-500/10 text-red-700 dark:text-red-400"
                    : "bg-amber-500/10 text-amber-700 dark:text-amber-400"
              }`}
            >
              {t(`settings.billing.status.${billingInfo.billingStatus}`)}
            </span>
          </div>

          {billingInfo.billingStatus !== "active" && billingInfo.isFree && (
            <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
              {t("settings.billing.freePlanRenewal")}
            </p>
          )}

          {billingInfo.billingStatus !== "active" && !billingInfo.isFree && (
            <PayNowButton
              initialOwnerPhone={billingInfo.ownerPhone}
              selectableTiers={selectableTiers}
              onPaymentConfirmed={handlePaymentConfirmed}
            />
          )}

          <div className="space-y-2 border-t pt-4">
            <Label htmlFor="billingNotificationEmail">{t("settings.billing.emailLabel")}</Label>
            <p className="text-xs text-muted-foreground">{t("settings.billing.emailHint")}</p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id="billingNotificationEmail"
                type="email"
                value={notificationEmail}
                onChange={(e) => {
                  setNotificationEmail(e.target.value);
                  setEmailError(null);
                }}
                disabled={savingEmail}
                className="sm:max-w-xs"
              />
              <Button type="button" variant="outline" size="sm" disabled={savingEmail} onClick={handleSaveNotificationEmail}>
                {savingEmail ? t("common.saving") : t("common.save")}
              </Button>
            </div>
            {emailError && <p className="text-sm text-red-600">{emailError}</p>}
          </div>
        </CardContent>
      </Card>
  );
}
