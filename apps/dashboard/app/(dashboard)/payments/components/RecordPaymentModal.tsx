"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { recordManualPaymentSchema, type RecordManualPaymentInput } from "@gymos/types";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { recordPayment, searchMembersForPaymentAction } from "../actions";

interface FieldErrors {
  memberId?: string;
  amount?: string;
  reason?: string;
}

// recordManualPaymentSchema's own issue messages are hardcoded English
// literals (matches MemberModal/PlanModal's established, project-wide
// pattern) -- map every reachable field to its own translated fallback
// instead of ever displaying issue.message directly.
const FIELD_ERROR_KEY: Record<keyof FieldErrors, string> = {
  memberId: "payments.modal.errors.memberRequired",
  amount: "payments.modal.errors.amountInvalid",
  reason: "payments.modal.errors.reasonInvalid",
};

const selectClassName =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

const METHOD_OPTIONS: { value: RecordManualPaymentInput["method"]; labelKey: string }[] = [
  { value: "cash", labelKey: "payments.modal.methodOptions.cash" },
  { value: "bank_transfer", labelKey: "payments.modal.methodOptions.bankTransfer" },
  { value: "manual_momo", labelKey: "payments.modal.methodOptions.manualMomo" },
];

/**
 * AD-10's Record Payment modal (max-width 480px). No Date field (Scope
 * Note -- created_at is set by the DB default at INSERT time). "Recorded
 * By" is informational only, the session's own display name -- never
 * submitted, the server derives the real actor from its own session
 * (payments.ts's recordManualPayment).
 */
export function RecordPaymentModal({
  recordedByName,
  onClose,
  onSaved,
}: {
  recordedByName: string;
  onClose: () => void;
  onSaved: (warning?: string) => void;
}) {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDialogElement>(null);

  const [memberId, setMemberId] = useState<string | null>(null);
  const [memberDisplay, setMemberDisplay] = useState("");
  const [memberQuery, setMemberQuery] = useState("");
  const [memberResults, setMemberResults] = useState<{ id: string; name: string; phone: string | null }[]>([]);
  const [showResults, setShowResults] = useState(false);

  const [method, setMethod] = useState<RecordManualPaymentInput["method"]>("cash");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");

  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  // Matches AttendancePageClient/MembersPageClient's own 300ms debounce
  // pattern for live search. Empty/blank query returns no results without
  // querying (AD-10: "must select from results"). `active` guards against a
  // slower, earlier keystroke's response resolving after a faster, later
  // one and overwriting fresher results with stale ones.
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

  function selectMember(member: { id: string; name: string; phone: string | null }) {
    setMemberId(member.id);
    setMemberDisplay(member.name);
    setMemberQuery("");
    setShowResults(false);
  }

  function clearMember() {
    setMemberId(null);
    setMemberDisplay("");
    setMemberQuery("");
  }

  function resetAndClose() {
    onClose();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFieldErrors({});
    setFormError(null);

    // The field is `<input type="number">`, which permits decimal/scientific
    // entry ("125.99", "1e5") -- `Number.parseInt` would silently truncate
    // those instead of rejecting them. Only a plain whole-digit string
    // parses to a number here; anything else becomes NaN, which
    // recordManualPaymentSchema's `z.number()` check rejects with a real
    // field error instead of a silently wrong amount.
    const parsedAmount = /^\d+$/.test(amount) ? Number(amount) : Number.NaN;
    const parsed = recordManualPaymentSchema.safeParse({
      memberId: memberId ?? "",
      method,
      amount: parsedAmount,
      reason,
    });

    if (!parsed.success) {
      const errors: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0] as keyof FieldErrors;
        if (!errors[field] && FIELD_ERROR_KEY[field]) {
          errors[field] = t(FIELD_ERROR_KEY[field]);
        }
      }
      setFieldErrors(errors);
      return;
    }

    setSubmitting(true);
    try {
      const { error } = await recordPayment(parsed.data);
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
      className="w-full max-w-[480px] rounded-md border p-0 backdrop:bg-black/50"
    >
      <form onSubmit={handleSubmit} className="space-y-4 p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{t("payments.modal.title")}</h2>
          <button
            type="button"
            aria-label={t("payments.modal.close")}
            onClick={resetAndClose}
            disabled={submitting}
            className="text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            <X size={16} />
          </button>
        </div>

        <div className="relative space-y-2">
          <Label htmlFor="paymentMember">{t("payments.modal.member")}</Label>
          {memberId ? (
            <div className="flex items-center gap-2">
              <Input id="paymentMember" value={memberDisplay} disabled />
              <Button type="button" variant="outline" size="sm" onClick={clearMember} disabled={submitting}>
                <X size={14} />
              </Button>
            </div>
          ) : (
            <Input
              id="paymentMember"
              value={memberQuery}
              placeholder={t("payments.modal.memberPlaceholder")}
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

        <div className="space-y-2">
          <Label htmlFor="paymentMethod">{t("payments.modal.method")}</Label>
          <select
            id="paymentMethod"
            value={method}
            onChange={(e) => setMethod(e.target.value as RecordManualPaymentInput["method"])}
            className={selectClassName}
          >
            {METHOD_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {t(option.labelKey)}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="paymentAmount">{t("payments.modal.amount")}</Label>
          <Input id="paymentAmount" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
          {fieldErrors.amount && <p className="text-sm text-red-600">{fieldErrors.amount}</p>}
        </div>

        <div className="space-y-2">
          <Label htmlFor="paymentReason">{t("payments.modal.reason")}</Label>
          <textarea
            id="paymentReason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="flex min-h-20 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          <p className="text-xs text-muted-foreground">{t("payments.modal.reasonCount", { count: reason.length })}</p>
          {fieldErrors.reason && <p className="text-sm text-red-600">{fieldErrors.reason}</p>}
        </div>

        <div className="space-y-2">
          <Label htmlFor="paymentRecordedBy">{t("payments.modal.recordedBy")}</Label>
          <Input id="paymentRecordedBy" value={recordedByName} disabled />
        </div>

        {formError && <p className="text-sm text-red-600">{formError}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={resetAndClose} disabled={submitting}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? t("payments.modal.recording") : t("payments.modal.recordButton")}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
