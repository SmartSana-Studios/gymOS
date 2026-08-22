"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { recordRefundSchema } from "@gymos/types";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { RefundEligiblePaymentRow } from "@/services/payments";
import { PAYMENT_METHOD_LABEL_KEY } from "../paymentLabels";
import { listRefundEligiblePaymentsAction, recordRefundAction, searchMembersForPaymentAction } from "../actions";

interface FieldErrors {
  memberId?: string;
  paymentId?: string;
  amount?: string;
  reason?: string;
}

// recordRefundSchema's own issue messages are hardcoded English literals
// (matches RecordPaymentModal's established pattern) -- map every reachable
// field to its own translated fallback instead of ever displaying
// issue.message directly.
const FIELD_ERROR_KEY: Record<Exclude<keyof FieldErrors, "memberId" | "paymentId">, string> = {
  amount: "payments.refundModal.errors.amountInvalid",
  reason: "payments.refundModal.errors.reasonInvalid",
};

/**
 * This story's own new entry point (Scope Note -- no mockup exists), modeled
 * directly on RecordPaymentModal's structure. Step 1 copies
 * RecordPaymentModal's member-search block verbatim; Step 2 (payment
 * selection) only appears once a member is selected, and prefills the
 * amount field from the selected payment's own amount (still editable,
 * capped server-side).
 */
export function RecordRefundModal({
  recordedByName,
  onClose,
  onSaved,
}: {
  recordedByName: string;
  onClose: () => void;
  onSaved: (warning?: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const dialogRef = useRef<HTMLDialogElement>(null);

  const [memberId, setMemberId] = useState<string | null>(null);
  const [memberDisplay, setMemberDisplay] = useState("");
  const [memberQuery, setMemberQuery] = useState("");
  const [memberResults, setMemberResults] = useState<{ id: string; name: string; phone: string | null }[]>([]);
  const [showResults, setShowResults] = useState(false);

  const [eligiblePayments, setEligiblePayments] = useState<RefundEligiblePaymentRow[] | null>(null);
  const [paymentId, setPaymentId] = useState<string | null>(null);

  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");

  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  // Matches RecordPaymentModal's own 300ms debounce pattern for live search.
  useEffect(() => {
    if (memberId || !memberQuery.trim()) return;
    let active = true;
    const handle = setTimeout(() => {
      searchMembersForPaymentAction(memberQuery).then(({ data }) => {
        if (active) setMemberResults(data ?? []);
      });
    }, 300);
    return () => {
      active = false;
      clearTimeout(handle);
    };
  }, [memberQuery, memberId]);

  // Step 2: fetch refund-eligible payments once a member is selected.
  // `eligiblePayments` already starts `null` and `clearMember()` resets it
  // directly on the only other path back to `!memberId` -- no synchronous
  // setState needed here (react-hooks/set-state-in-effect).
  useEffect(() => {
    if (!memberId) return;
    let active = true;
    listRefundEligiblePaymentsAction(memberId).then(({ data, error }) => {
      if (!active) return;
      if (error) setFormError(t("common.loadError"));
      setEligiblePayments(data ?? []);
    });
    return () => {
      active = false;
    };
  }, [memberId, t]);

  function selectMember(member: { id: string; name: string; phone: string | null }) {
    setMemberId(member.id);
    setMemberDisplay(member.name);
    setMemberQuery("");
    setShowResults(false);
    setPaymentId(null);
    setAmount("");
  }

  function clearMember() {
    setMemberId(null);
    setMemberDisplay("");
    setMemberQuery("");
    setEligiblePayments(null);
    setPaymentId(null);
    setAmount("");
  }

  function selectPayment(payment: RefundEligiblePaymentRow) {
    setPaymentId(payment.id);
    setAmount(String(payment.amount));
  }

  function methodLabel(method: string): string {
    const key = PAYMENT_METHOD_LABEL_KEY[method];
    return key ? t(key) : method;
  }

  function formatPaymentDate(iso: string): string {
    return new Date(iso).toLocaleString(i18n.language, { dateStyle: "short", timeStyle: "short" });
  }

  function resetAndClose() {
    onClose();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFieldErrors({});
    setFormError(null);

    if (!memberId) {
      setFieldErrors({ memberId: t("payments.refundModal.errors.memberRequired") });
      return;
    }
    if (!paymentId) {
      setFieldErrors({ paymentId: t("payments.refundModal.errors.paymentRequired") });
      return;
    }

    // Same `/^\d+$/` whole-digit parsing guard RecordPaymentModal uses --
    // rejects decimal/scientific entry as a field error instead of silently
    // truncating it.
    const parsedAmount = /^\d+$/.test(amount) ? Number(amount) : Number.NaN;
    const parsed = recordRefundSchema.safeParse({
      paymentId,
      amount: parsedAmount,
      reason,
    });

    if (!parsed.success) {
      const errors: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0] as keyof FieldErrors;
        if (field === "amount" || field === "reason") {
          if (!errors[field]) errors[field] = t(FIELD_ERROR_KEY[field]);
        }
      }
      setFieldErrors(errors);
      return;
    }

    setSubmitting(true);
    try {
      const { error } = await recordRefundAction(parsed.data);
      if (error) {
        if (error.code === "audit_log_failed") {
          onSaved(error.message);
          return;
        }
        setFormError(error.message);
        return;
      }
      onSaved();
    } catch {
      setFormError(t("common.somethingWentWrong"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      onClose={resetAndClose}
      onCancel={(e) => {
        if (submitting) e.preventDefault();
      }}
      className="w-full max-w-[480px] rounded-md border bg-background p-0 text-foreground backdrop:bg-black/50"
    >
      <form onSubmit={handleSubmit} className="space-y-4 p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{t("payments.refundModal.title")}</h2>
          <button
            type="button"
            aria-label={t("payments.refundModal.close")}
            onClick={resetAndClose}
            disabled={submitting}
            className="text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            <X size={16} />
          </button>
        </div>

        <div className="relative space-y-2">
          <Label htmlFor="refundMember">{t("payments.refundModal.member")}</Label>
          {memberId ? (
            <div className="flex items-center gap-2">
              <Input id="refundMember" value={memberDisplay} disabled />
              <Button type="button" variant="outline" size="sm" onClick={clearMember} disabled={submitting}>
                <X size={14} />
              </Button>
            </div>
          ) : (
            <Input
              id="refundMember"
              value={memberQuery}
              placeholder={t("payments.refundModal.memberPlaceholder")}
              onChange={(e) => {
                setMemberQuery(e.target.value);
                setShowResults(true);
              }}
              onFocus={() => setShowResults(true)}
              onBlur={() => setTimeout(() => setShowResults(false), 150)}
              autoComplete="off"
            />
          )}
          {showResults && !memberId && memberQuery.trim() && memberResults.length > 0 && (
            <ul className="absolute z-10 max-h-48 w-full overflow-auto rounded-md border bg-popover shadow-md">
              {memberResults.map((member) => (
                <li key={member.id}>
                  <button
                    type="button"
                    className="w-full px-3 py-2 text-left text-sm hover:bg-muted"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => selectMember(member)}
                  >
                    {member.name}
                    {member.phone ? ` — ${member.phone}` : ""}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {fieldErrors.memberId && <p className="text-sm text-red-600">{fieldErrors.memberId}</p>}
        </div>

        {memberId && (
          <div className="space-y-2">
            <Label>{t("payments.refundModal.paymentLabel")}</Label>
            {eligiblePayments === null ? (
              <p className="text-sm text-muted-foreground">{t("payments.refundModal.loadingPayments")}</p>
            ) : eligiblePayments.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("payments.refundModal.noEligiblePayments")}</p>
            ) : (
              <ul className="space-y-1">
                {eligiblePayments.map((payment) => (
                  <li key={payment.id}>
                    <label className="flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm has-[:checked]:border-primary">
                      <input
                        type="radio"
                        name="refundPaymentId"
                        value={payment.id}
                        checked={paymentId === payment.id}
                        onChange={() => selectPayment(payment)}
                      />
                      <span>
                        {payment.amount.toLocaleString(i18n.language)} {payment.currency} —{" "}
                        {methodLabel(payment.method)} — {formatPaymentDate(payment.createdAt)}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
            {fieldErrors.paymentId && <p className="text-sm text-red-600">{fieldErrors.paymentId}</p>}
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="refundAmount">{t("payments.refundModal.amount")}</Label>
          <Input
            id="refundAmount"
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            disabled={!paymentId}
          />
          {fieldErrors.amount && <p className="text-sm text-red-600">{fieldErrors.amount}</p>}
        </div>

        <div className="space-y-2">
          <Label htmlFor="refundReason">{t("payments.refundModal.reason")}</Label>
          <textarea
            id="refundReason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={!paymentId}
            className="flex min-h-20 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          <p className="text-xs text-muted-foreground">
            {t("payments.refundModal.reasonCount", { count: reason.length })}
          </p>
          {fieldErrors.reason && <p className="text-sm text-red-600">{fieldErrors.reason}</p>}
        </div>

        <div className="space-y-2">
          <Label htmlFor="refundRecordedBy">{t("payments.refundModal.recordedBy")}</Label>
          <Input id="refundRecordedBy" value={recordedByName} disabled />
        </div>

        {formError && <p className="text-sm text-red-600">{formError}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={resetAndClose} disabled={submitting}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" disabled={submitting || !paymentId}>
            {submitting ? t("payments.refundModal.recording") : t("payments.refundModal.recordButton")}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
