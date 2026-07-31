"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { PendingPaymentRow } from "@/services/payments";
import { PAYMENT_METHOD_LABEL_KEY, PAYMENT_STATUS_BADGE_CONFIG } from "../paymentLabels";
import { RecordPaymentModal } from "./RecordPaymentModal";
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
  recordedByName,
}: {
  pendingPayments: PendingPaymentRow[];
  recordedByName: string;
}) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const [isRefreshing, startRefreshTransition] = useTransition();

  const [recordModalOpen, setRecordModalOpen] = useState(false);
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

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">{t("payments.title")}</h1>
        <Button onClick={() => setRecordModalOpen(true)}>{t("payments.recordPaymentButton")}</Button>
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
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={isRefreshing}
                          onClick={() => setVerifyingPayment(row)}
                        >
                          {t("payments.verifyButton")}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={isRefreshing}
                          onClick={() => setFlaggingPayment(row)}
                        >
                          {t("payments.flagButton")}
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
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
