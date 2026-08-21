"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { AlertTriangle, CheckCircle2, Flag, MoreVertical } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import type { PendingPaymentRow, PaymentDiscrepancyRow } from "@/services/payments";
import type { MemberRole } from "@/services/session";
import {
  PAYMENT_METHOD_LABEL_KEY,
  PAYMENT_STATUS_BADGE_CONFIG,
  PAYMENT_DISCREPANCY_TYPE_LABEL_KEY,
} from "../paymentLabels";
import { RecordPaymentModal } from "./RecordPaymentModal";
import { RecordRefundModal } from "./RecordRefundModal";
import { VerifyPaymentConfirmDialog } from "./VerifyPaymentConfirmDialog";
import { FlagPaymentDialog } from "./FlagPaymentDialog";

/**
 * AD-09's Verification Queue section (the "All Payments" ledger table is
 * out of scope, Scope Note). Every row this page ever receives has
 * `status: "pending"` (listPendingPayments only selects pending rows) --
 * the status badge always renders "Pending" here; a verified/flagged row
 * simply stops appearing in the queue on the next refresh (AC #3's "the
 * queue count updates").
 */
export function PaymentsPageClient({
  pendingPayments,
  discrepancies,
  recordedByName,
  role,
}: {
  pendingPayments: PendingPaymentRow[];
  discrepancies: PaymentDiscrepancyRow[];
  recordedByName: string;
  role: MemberRole;
}) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const [isRefreshing, startRefreshTransition] = useTransition();

  const [recordModalOpen, setRecordModalOpen] = useState(false);
  const [refundModalOpen, setRefundModalOpen] = useState(false);
  const [verifyingPayment, setVerifyingPayment] = useState<PendingPaymentRow | null>(null);
  const [flaggingPayment, setFlaggingPayment] = useState<PendingPaymentRow | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  // Mirrors MembersPageClient's own showToast pattern -- surfaces the
  // audit_log_failed warning (payment/verify/flag succeeded, only its audit
  // entry didn't) instead of silently discarding it.
  function showToast(message: string) {
    setToast(message);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 4000);
  }

  function refresh() {
    startRefreshTransition(() => {
      router.refresh();
    });
  }

  function formatAmount(amount: number): string {
    return amount.toLocaleString(i18n.language);
  }

  function methodLabel(method: string): string {
    const key = PAYMENT_METHOD_LABEL_KEY[method];
    return key ? t(key) : method;
  }

  function discrepancyTypeLabel(discrepancyType: string): string {
    const key = PAYMENT_DISCREPANCY_TYPE_LABEL_KEY[discrepancyType];
    return key ? t(key) : discrepancyType;
  }

  // Mirrors AttendancePageClient's own toLocaleString(i18n.language, ...) fix
  // (Story 3.1's Metrics-page bug) -- never call toLocaleString() with no
  // argument, it silently falls back to the server's locale instead of the
  // request's.
  function formatDetectedAt(iso: string): string {
    return new Date(iso).toLocaleString(i18n.language, { dateStyle: "short", timeStyle: "short" });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">{t("payments.title")}</h1>
        <div className="flex gap-2">
          <Button onClick={() => setRecordModalOpen(true)}>{t("payments.recordPaymentButton")}</Button>
          {(role === "owner" || role === "manager") && (
            <Button variant="outline" onClick={() => setRefundModalOpen(true)}>
              {t("payments.recordRefundButton")}
            </Button>
          )}
        </div>
      </div>

      {pendingPayments.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-md border border-dashed py-16 text-center">
          <p className="text-sm text-muted-foreground">{t("payments.emptyQueue")}</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/50 text-left">
              <tr>
                <th className="p-3 font-medium">{t("payments.table.member")}</th>
                <th className="p-3 font-medium">{t("payments.table.amount")}</th>
                <th className="p-3 font-medium">{t("payments.table.method")}</th>
                <th className="p-3 font-medium">{t("payments.table.submittedBy")}</th>
                <th className="p-3 font-medium">{t("payments.table.reason")}</th>
                <th className="p-3 font-medium">{t("payments.table.status")}</th>
                <th className="p-3 font-medium">{t("payments.table.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {pendingPayments.map((row) => {
                const badge = PAYMENT_STATUS_BADGE_CONFIG.pending;
                const Icon = badge.icon;
                return (
                  <tr key={row.id} className="border-b last:border-0">
                    <td className="p-3">{row.memberName}</td>
                    <td className="p-3">{formatAmount(row.amount)}</td>
                    <td className="p-3">{methodLabel(row.method)}</td>
                    <td className="p-3">{row.actorName ?? "—"}</td>
                    <td className="p-3 max-w-xs truncate" title={row.reason ?? ""}>
                      {row.reason ?? "—"}
                    </td>
                    <td className="p-3">
                      <Badge variant="outline" className={badge.className}>
                        <Icon size={12} className="mr-1" />
                        {t(badge.labelKey)}
                      </Badge>
                    </td>
                    <td className="p-3">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="outline"
                            size="sm"
                            aria-label={t("payments.actionsMenu", { name: row.memberName || "—" })}
                          >
                            {t("payments.actionsButton")}
                            <MoreVertical size={14} aria-hidden="true" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            className="text-green-700 focus:text-green-800"
                            disabled={isRefreshing}
                            onClick={() => setVerifyingPayment(row)}
                          >
                            <CheckCircle2 size={14} />
                            {t("payments.verifyButton")}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="text-orange-700 focus:text-orange-800"
                            disabled={isRefreshing}
                            onClick={() => setFlaggingPayment(row)}
                          >
                            <Flag size={14} />
                            {t("payments.flagButton")}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/*
        Story 4.4: Discrepancies section, read-only (no resolve/dismiss
        action exists in any AC/FR for V1). Rendered only when >=1 row
        exists -- same "no empty-state copy for a section whose default,
        common case is 'nothing to show'" precedent as Story 3.1's Super
        Admin job-failure list.
      */}
      {discrepancies.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-lg font-semibold">{t("payments.discrepancies.title")}</h2>
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/50 text-left">
                <tr>
                  <th className="p-3 font-medium">{t("payments.table.member")}</th>
                  <th className="p-3 font-medium">{t("payments.discrepancies.table.type")}</th>
                  <th className="p-3 font-medium">{t("payments.table.amount")}</th>
                  <th className="p-3 font-medium">{t("payments.discrepancies.table.detectedAt")}</th>
                </tr>
              </thead>
              <tbody>
                {discrepancies.map((row) => (
                  <tr key={row.id} className="border-b last:border-0">
                    <td className="p-3">{row.memberName}</td>
                    <td className="p-3">
                      <Badge variant="outline" className="border-red-200 bg-red-100 text-red-800">
                        <AlertTriangle size={12} className="mr-1" />
                        {discrepancyTypeLabel(row.discrepancyType)}
                      </Badge>
                    </td>
                    <td className="p-3">
                      {row.discrepancyType === "amount_mismatch"
                        ? t("payments.discrepancies.amountMismatchLine", {
                            internal: formatAmount(row.amount),
                            reported: formatAmount(Number(row.details.webhookAmount ?? 0)),
                          })
                        : row.discrepancyType === "wrong_account_settlement"
                          ? t("payments.discrepancies.wrongAccountSettlementLine", {
                              expected: String(row.details.expectedBusinessId ?? "—"),
                              actual: String(row.details.webhookBusinessId ?? "—"),
                            })
                          : formatAmount(row.amount)}
                    </td>
                    <td className="p-3">{formatDetectedAt(row.detectedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {recordModalOpen && (
        <RecordPaymentModal
          recordedByName={recordedByName}
          onClose={() => setRecordModalOpen(false)}
          onSaved={(warning) => {
            setRecordModalOpen(false);
            if (warning) showToast(warning);
            refresh();
          }}
        />
      )}

      {refundModalOpen && (
        <RecordRefundModal
          recordedByName={recordedByName}
          onClose={() => setRefundModalOpen(false)}
          onSaved={(warning) => {
            setRefundModalOpen(false);
            if (warning) showToast(warning);
            refresh();
          }}
        />
      )}

      {verifyingPayment && (
        <VerifyPaymentConfirmDialog
          payment={verifyingPayment}
          onClose={() => setVerifyingPayment(null)}
          onDone={(warning) => {
            setVerifyingPayment(null);
            if (warning) showToast(warning);
            refresh();
          }}
        />
      )}

      {flaggingPayment && (
        <FlagPaymentDialog
          payment={flaggingPayment}
          onClose={() => setFlaggingPayment(null)}
          onDone={(warning) => {
            setFlaggingPayment(null);
            if (warning) showToast(warning);
            refresh();
          }}
        />
      )}

      {toast && (
        <div
          role="status"
          className="fixed bottom-4 right-4 max-w-sm rounded-md bg-primary px-4 py-3 text-sm text-primary-foreground shadow-lg"
        >
          {toast}
        </div>
      )}
    </div>
  );
}
