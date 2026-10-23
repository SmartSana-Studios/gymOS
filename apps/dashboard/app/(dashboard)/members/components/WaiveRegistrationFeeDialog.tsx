"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { waiveRegistrationFeeSchema } from "@gymos/types";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { MemberListRow } from "@/services/members";
import { SupportCodeField, goToLoginExpired, isSupportCodeWellFormed } from "@/components/support-code-field";
import { waiveRegistrationFeeAction } from "@/app/(dashboard)/payments/actions";

/**
 * Story 18.6: waive a member's registration fee (manager, supervisor, owner;
 * the RPC enforces the role). The member is settled without any payment, and
 * nothing in the UI undoes it, so the dialog says so and the confirm button
 * names its target (UX-DR12), as DeactivateMemberDialog does.
 */
export function WaiveRegistrationFeeDialog({
  member,
  isSupport = false,
  onClose,
  onDone,
}: {
  member: MemberListRow;
  /** Story 23-6c: a GymOS Support session types a fresh authenticator code; staff roles see no change. */
  isSupport?: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [reason, setReason] = useState("");
  const [authCode, setAuthCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setError(null);

    const parsed = waiveRegistrationFeeSchema.safeParse({ memberId: member.id, reason });
    if (!parsed.success) {
      setError(t("members.feeWaive.errors.reasonInvalid"));
      return;
    }

    if (isSupport && !isSupportCodeWellFormed(authCode)) {
      setError(t("supportStepUp.codeRequired"));
      return;
    }

    setSubmitting(true);
    try {
      const { error: actionError } = await waiveRegistrationFeeAction(isSupport ? { ...parsed.data, authCode } : parsed.data);
      if (actionError) {
        setAuthCode("");
        if (actionError.code === "account_locked") {
          goToLoginExpired();
          return;
        }
        setError(actionError.message || t("members.feeWaive.errors.waiveFailed"));
        return;
      }
      onDone();
    } catch {
      setAuthCode("");
      setError(t("members.feeWaive.errors.waiveFailed"));
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
      className="w-full max-w-[420px] rounded-md border bg-background p-0 text-foreground backdrop:bg-black/50"
    >
      <form onSubmit={handleSubmit} className="space-y-4 p-6">
        <h2 className="text-lg font-semibold">{t("members.feeWaive.title", { name: member.name })}</h2>
        <p className="text-sm text-muted-foreground">{t("members.feeWaive.body", { name: member.name })}</p>

        <div className="space-y-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={submitting}
            aria-pressed={reason === t("members.feeWaive.presetSessionGuest")}
            onClick={() => setReason(t("members.feeWaive.presetSessionGuest"))}
          >
            {t("members.feeWaive.presetSessionGuest")}
          </Button>
          <Label htmlFor="feeWaiveReason">{t("members.feeWaive.reason")}</Label>
          <textarea
            id="feeWaiveReason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={submitting}
            className="flex min-h-20 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          <p className="text-xs text-muted-foreground">{t("members.feeWaive.reasonHint")}</p>
        </div>

        {isSupport && <SupportCodeField id="feeWaiveAuthCode" value={authCode} onChange={setAuthCode} disabled={submitting} />}

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" variant="destructive" disabled={submitting || reason.trim().length < 10}>
            {submitting
              ? t("members.feeWaive.waiving")
              : t("members.feeWaive.confirmButton", { name: member.name })}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
