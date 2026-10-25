"use client";

import { useTranslation } from "react-i18next";

import { TablePagination } from "@/components/TablePagination";
import { useClientPagination } from "@/hooks/use-table-pagination";
import type { RefundHistoryRow } from "@/services/payments";
import { PAYMENT_METHOD_LABEL_KEY, PAYMENT_PURPOSE_LABEL_KEY } from "../paymentLabels";

export interface RefundHistoryData {
  rows: RefundHistoryRow[];
  total: number;
}

/**
 * Refund history: what was refunded, when, by whom and why. Read-only; a refund
 * is recorded from the Record Refund modal. Shown to every role that can open
 * Payments (the `refunds` read policy matches the payments one).
 */
export function RefundHistory({ refunds, hasError }: { refunds: RefundHistoryData | null; hasError: boolean }) {
  const { t, i18n } = useTranslation();
  const pg = useClientPagination(refunds?.rows ?? []);

  function formatDate(iso: string): string {
    return new Date(iso).toLocaleString(i18n.language, { dateStyle: "short", timeStyle: "short" });
  }

  function paymentLabel(row: RefundHistoryRow): string {
    const purposeKey = PAYMENT_PURPOSE_LABEL_KEY[row.purpose];
    const methodKey = PAYMENT_METHOD_LABEL_KEY[row.method];
    const purpose = purposeKey ? t(purposeKey) : row.purpose;
    const method = methodKey ? t(methodKey) : row.method;
    return [purpose, method].filter(Boolean).join(" · ");
  }

  return (
    <section className="space-y-2" aria-label={t("payments.refundHistory.title")}>
      <h2 className="text-lg font-semibold">{t("payments.refundHistory.title")}</h2>

      {hasError || !refunds ? (
        <div className="rounded-md border border-dashed py-8 text-center text-sm text-red-600">
          {t("payments.refundHistory.loadError")}
        </div>
      ) : refunds.rows.length === 0 ? (
        <div className="rounded-md border border-dashed py-12 text-center text-sm text-muted-foreground">
          {t("payments.refundHistory.empty")}
        </div>
      ) : (
        <>
          {refunds.total > refunds.rows.length && (
            <p className="text-sm text-muted-foreground">
              {t("payments.refundHistory.truncated", { shown: refunds.rows.length, total: refunds.total })}
            </p>
          )}
          <TablePagination compact {...pg} />
          <div className="overflow-x-auto rounded-md border bg-card">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/50 text-left">
                <tr>
                  <th className="p-3 font-medium">{t("payments.refundHistory.table.date")}</th>
                  <th className="p-3 font-medium">{t("payments.refundHistory.table.member")}</th>
                  <th className="p-3 font-medium">{t("payments.refundHistory.table.payment")}</th>
                  <th className="p-3 font-medium">{t("payments.refundHistory.table.refunded")}</th>
                  <th className="p-3 font-medium">{t("payments.refundHistory.table.session")}</th>
                  <th className="p-3 font-medium">{t("payments.refundHistory.table.reason")}</th>
                  <th className="p-3 font-medium">{t("payments.refundHistory.table.by")}</th>
                </tr>
              </thead>
              <tbody>
                {pg.pageItems.map((row) => (
                  <tr key={row.id} className="border-b last:border-0">
                    <td className="p-3">{formatDate(row.createdAt)}</td>
                    <td className="p-3">{row.memberName || "—"}</td>
                    <td className="p-3">{paymentLabel(row) || "—"}</td>
                    <td className="p-3">
                      {row.amount.toLocaleString(i18n.language)}
                      {row.amount < row.paymentAmount && (
                        <span className="block text-xs text-muted-foreground">
                          {t("payments.refundHistory.partial", {
                            amount: row.paymentAmount.toLocaleString(i18n.language),
                          })}
                        </span>
                      )}
                    </td>
                    <td className="p-3">
                      {row.sessionState ? t(`payments.refundHistory.session.${row.sessionState}`) : "—"}
                    </td>
                    <td className="p-3 max-w-xs truncate" title={row.reason}>
                      {row.reason}
                    </td>
                    <td className="p-3">{row.actorName ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <TablePagination {...pg} />
        </>
      )}
    </section>
  );
}
