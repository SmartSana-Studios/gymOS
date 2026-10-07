"use client";

import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { TablePagination } from "@/components/TablePagination";
import { useUrlPagination } from "@/hooks/use-table-pagination";
import type { GymPaymentPage } from "@/services/gyms";

const STATUS_LABEL_KEY: Record<string, string> = {
  pending: "gyms.paymentRecords.status.pending",
  processing: "gyms.paymentRecords.status.processing",
  verified: "gyms.paymentRecords.status.verified",
  flagged: "gyms.paymentRecords.status.flagged",
};

/**
 * Story 1.14 AC #3: read-only payment records, visible only once escalated.
 * `payments === null` means "not escalated" and renders nothing, mirroring
 * GymMembersTable.
 *
 * `method` has no exhaustive label map: `payments.method` is `text`, not an
 * enum (0036 dropped the `payment_method` enum), so it renders the raw
 * stored value rather than assuming a closed set.
 */
export function GymPaymentsTable({ payments }: { payments: GymPaymentPage | null }) {
  const { t, i18n } = useTranslation();
  // Own page/size params so the other table on this route keeps its position.
  const pagination = useUrlPagination({ pageParam: "ppage", sizeParam: "psize" });

  if (payments === null) {
    return null;
  }

  function formatAmount(amount: number, currency: string): string {
    return `${amount.toLocaleString(i18n.language)} ${currency}`;
  }

  function formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString(i18n.language);
  }

  function statusLabel(status: string): string {
    const key = STATUS_LABEL_KEY[status];
    return key ? t(key) : status;
  }

  return (
    <div className="space-y-3 rounded-md border p-6">
      <h2 className="text-sm font-semibold text-muted-foreground">
        {t("gyms.paymentRecords.title")}
      </h2>

      {payments.total === 0 ? (
        <p className="text-sm text-muted-foreground">{t("gyms.paymentRecords.empty")}</p>
      ) : payments.rows.length === 0 ? (
        // total > 0 but this page has no rows -- a stale ppage param past
        // the last page, not "no payments." Same distinction
        // GymsPageClient.tsx:170-190 makes.
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <p className="text-sm text-muted-foreground">{t("gyms.paymentRecords.emptyPage")}</p>
          <Button variant="outline" size="sm" onClick={() => pagination.onPageChange(1)}>
            {t("gyms.backToPage1")}
          </Button>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/50 text-left">
                <tr>
                  <th scope="col" className="p-3 font-medium">
                    {t("gyms.paymentRecords.columns.member")}
                  </th>
                  <th scope="col" className="p-3 font-medium">
                    {t("gyms.paymentRecords.columns.amount")}
                  </th>
                  <th scope="col" className="p-3 font-medium">
                    {t("gyms.paymentRecords.columns.method")}
                  </th>
                  <th scope="col" className="p-3 font-medium">
                    {t("gyms.paymentRecords.columns.status")}
                  </th>
                  <th scope="col" className="p-3 font-medium">
                    {t("gyms.paymentRecords.columns.date")}
                  </th>
                  <th scope="col" className="p-3 font-medium">
                    {t("gyms.paymentRecords.columns.reason")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {payments.rows.map((payment) => (
                  <tr key={payment.id} className="border-b last:border-0">
                    <td className="p-3">{payment.memberName ?? "—"}</td>
                    <td className="p-3">{formatAmount(payment.amount, payment.currency)}</td>
                    <td className="p-3">{payment.method}</td>
                    <td className="p-3">{statusLabel(payment.status)}</td>
                    <td className="p-3">{formatDate(payment.createdAt)}</td>
                    <td className="p-3">{payment.reason ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <TablePagination
            page={payments.page}
            pageSize={payments.pageSize}
            total={payments.total}
            onPageChange={pagination.onPageChange}
            onPageSizeChange={pagination.onPageSizeChange}
          />
        </>
      )}
    </div>
  );
}
