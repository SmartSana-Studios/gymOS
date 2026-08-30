"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { applyCreditSchema, APPLY_CREDIT_MAX_DAYS, type AppError } from "@gymos/types";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";

// SA-07: "grants N days or one billing cycle free". Resolved client-side
// against the row's own saasBillingInterval (already fetched, no extra
// query) -- 30/365 is a simplification of "one calendar month/year", same
// approximation this codebase's own reminder-offset constants already
// accept elsewhere; the RPC itself only ever receives a resolved integer
// day count, matching apply_saas_billing_credit()'s own signature.
const ONE_CYCLE_DAYS: Record<string, number> = {
  monthly: 30,
  annual: 365,
};

export function ApplyCreditDialog({
  gymId,
  gymName,
  saasBillingInterval,
  onClose,
  onDone,
  runAction,
}: {
  gymId: string;
  gymName: string;
  saasBillingInterval: string;
  onClose: () => void;
  onDone: (warning?: string) => void;
  runAction: (gymId: string, input: unknown) => Promise<{ error: AppError | null }>;
}) {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const oneCycleDays = ONE_CYCLE_DAYS[saasBillingInterval] ?? ONE_CYCLE_DAYS.monthly;
  const [mode, setMode] = useState<"oneCycle" | "custom">("oneCycle");
  const [customDays, setCustomDays] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const days = mode === "oneCycle" ? oneCycleDays : Number(customDays);
    const parsed = applyCreditSchema.safeParse({ days, reason });
    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0];
      // Review fix: applyCreditSchema's own Zod messages are hardcoded
      // English (matches every other schema in this file) -- substitute the
      // localized key for the one case this story added a translation for.
      setError(
        firstIssue?.path[0] === "days"
          ? t("billing.applyCredit.errors.daysPositive")
          : (firstIssue?.message ?? t("common.invalidInput")),
      );
      return;
    }

    setSubmitting(true);
    try {
      const { error: actionError } = await runAction(gymId, parsed.data);
      if (actionError) {
        if (actionError.code === "audit_log_failed") {
          onDone(actionError.message);
          return;
        }
        setError(actionError.message);
        return;
      }
      onDone();
    } catch {
      setError(t("common.somethingWentWrong"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      onCancel={(e) => {
        if (submitting) e.preventDefault();
      }}
      className="w-full max-w-[420px] rounded-md border p-0 backdrop:bg-black/50"
    >
      <form onSubmit={handleSubmit} className="space-y-4 p-6">
        <h2 className="text-lg font-semibold">{t("billing.applyCredit.title", { gymName })}</h2>

        <div className="space-y-2">
          <Label>{t("billing.applyCredit.daysLabel")}</Label>
          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="creditMode"
                checked={mode === "oneCycle"}
                onChange={() => setMode("oneCycle")}
              />
              {t("billing.applyCredit.oneCycle", { days: oneCycleDays })}
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="creditMode"
                checked={mode === "custom"}
                onChange={() => setMode("custom")}
              />
              {t("billing.applyCredit.customDays")}
            </label>
            {mode === "custom" && (
              <Input
                type="number"
                min={1}
                max={APPLY_CREDIT_MAX_DAYS}
                value={customDays}
                onChange={(e) => setCustomDays(e.target.value)}
                className="max-w-[120px]"
              />
            )}
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="creditReason">{t("billing.applyCredit.reasonLabel")}</Label>
          <textarea
            id="creditReason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="flex min-h-20 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? t("billing.applyCredit.applying") : t("billing.applyCredit.confirmButton")}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
