"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { voidRegistrationFeeSchema } from "@gymos/types";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { MemberListRow, MemberRegistrationFeeState } from "@/services/members";
import { PAYMENT_METHOD_LABEL_KEY } from "@/app/(dashboard)/payments/paymentLabels";
import {
  getMemberRegistrationFeeStateAction,
  voidRegistrationFeeAction,
} from "@/app/(dashboard)/payments/actions";

/**
 * Story 18.6: void a registration fee recorded in error (owner, supervisor; the
 * RPC enforces the role). A correction, not a refund: the member goes back to
 * awaiting. The dialog reads the fee payment first. A Tara (`mobile_money`) fee
 * cannot be voided here, so it shows a hint and no submit; a member with no
 * fee payment (waived, or settled without one) has nothing to void.
 */
export function VoidRegistrationFeeDialog({
  member,
  onClose,
  onDone,
}: {
  member: MemberListRow;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t, i18n } = useTranslation();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [feeState, setFeeState] = useState<MemberRegistrationFeeState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  useEffect(() => {
    let active = true;
    getMemberRegistrationFeeStateAction(member.id)
      .then(({ data, error: actionError }) => {
        if (!active) return;
        if (actionError || !data) {
          setLoadError(actionError?.message || t("members.feeVoid.errors.loadFailed"));
          return;
        }
        setFeeState(data);
      })
      .catch(() => {
        if (!active) return;
        setLoadError(t("members.feeVoid.errors.loadFailed"));
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [member.id]);

  const paid = feeState?.kind === "paid" ? feeState : null;
  const isTaraFee = paid?.method === "mobile_money";
  const canVoid = paid !== null && !isTaraFee;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting || !paid || isTaraFee) return;
    setError(null);

    const parsed = voidRegistrationFeeSchema.safeParse({ paymentId: paid.paymentId, reason });
    if (!parsed.success) {
      setError(t("members.feeVoid.errors.reasonInvalid"));
      return;
    }

    setSubmitting(true);
    try {
      const { error: actionError } = await voidRegistrationFeeAction(parsed.data);
      if (actionError) {
        setError(actionError.message || t("members.feeVoid.errors.voidFailed"));
        return;
      }
      onDone();
    } catch {
      setError(t("members.feeVoid.errors.voidFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  function methodLabel(method: string): string {
    const key = PAYMENT_METHOD_LABEL_KEY[method];
    return key ? t(key) : method;
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
        <h2 className="text-lg font-semibold">{t("members.feeVoid.title", { name: member.name })}</h2>

        {loadError ? (
          <p className="text-sm text-red-600">{loadError}</p>
        ) : !feeState ? (
          <p className="text-sm text-muted-foreground">{t("members.feeVoid.loading")}</p>
        ) : !paid ? (
          <p className="text-sm text-muted-foreground">{t("members.feeVoid.nothingToVoid")}</p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">{t("members.feeVoid.body")}</p>
            <p className="text-sm font-medium">{t("members.feeVoid.notARefund")}</p>
            <p className="text-sm">
              {t("members.feeVoid.paymentLine", {
                amount: paid.amount.toLocaleString(i18n.language),
                currency: paid.currency,
                method: methodLabel(paid.method),
              })}
            </p>

            {isTaraFee ? (
              <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                {t("members.feeVoid.taraHint")}
              </p>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="feeVoidReason">{t("members.feeVoid.reason")}</Label>
                <textarea
                  id="feeVoidReason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  disabled={submitting}
                  className="flex min-h-20 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
                <p className="text-xs text-muted-foreground">{t("members.feeVoid.reasonHint")}</p>
              </div>
            )}
          </>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
            {t("common.cancel")}
          </Button>
          {canVoid && (
            <Button type="submit" variant="destructive" disabled={submitting || reason.trim().length < 10}>
              {submitting
                ? t("members.feeVoid.voiding")
                : t("members.feeVoid.confirmButton", { name: member.name })}
            </Button>
          )}
        </div>
      </form>
    </dialog>
  );
}
