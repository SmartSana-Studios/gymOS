"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateMessagingInstance } from "../actions";

/** Story 1.13 AC #1-#3: single-field inline form (not a modal -- this is
 * one platform-wide value, not a list of rows like Tiers/Payment
 * Providers). update_messaging_instance() is atomic (update + audit log in
 * one RPC call, mirroring activate_payment_provider()), so unlike
 * TierModal's audit_log_failed handling there is no separate audit-write
 * failure path to special-case here -- any RPC error is a blocking
 * formError, matching PaymentProvidersPageClient's simpler pattern. */
export function MessagingSettingsPageClient({
  initialInstanceId,
  initialUpdatedAt,
}: {
  initialInstanceId: string | null;
  initialUpdatedAt: string | null;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const [instanceId, setInstanceId] = useState(initialInstanceId ?? "");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); // validate on submit only, UX-DR11
    setFieldError(null);
    setFormError(null);

    const trimmed = instanceId.trim();
    if (trimmed === "") {
      setFieldError(t("messaging.errors.instanceIdRequired"));
      return;
    }

    setSubmitting(true);
    try {
      const { error } = await updateMessagingInstance({ instanceId: trimmed });
      if (error) {
        setFormError(error.message);
        return;
      }
      router.refresh();
    } catch {
      setFormError(t("common.somethingWentWrong"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">{t("messaging.title")}</h1>

      <form onSubmit={handleSubmit} className="max-w-md space-y-4 rounded-md border p-4">
        <div className="space-y-2">
          <Label htmlFor="instanceId">{t("messaging.instanceIdLabel")}</Label>
          <Input
            id="instanceId"
            placeholder={t("messaging.instanceIdPlaceholder")}
            value={instanceId}
            onChange={(e) => setInstanceId(e.target.value)}
          />
          {fieldError && <p className="text-sm text-red-600">{fieldError}</p>}
          {!initialInstanceId && !fieldError && (
            <p className="text-sm text-muted-foreground">{t("messaging.notConfigured")}</p>
          )}
          {initialUpdatedAt && (
            <p className="text-xs text-muted-foreground">
              {t("messaging.lastUpdated", {
                date: new Date(initialUpdatedAt).toLocaleString(),
              })}
            </p>
          )}
        </div>

        {formError && <p className="text-sm text-red-600">{formError}</p>}

        <div className="flex justify-end">
          <Button type="submit" disabled={submitting}>
            {submitting ? t("common.saving") : t("messaging.save")}
          </Button>
        </div>
      </form>
    </div>
  );
}
