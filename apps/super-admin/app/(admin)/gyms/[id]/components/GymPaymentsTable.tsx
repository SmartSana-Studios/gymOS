"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { GymPaymentPage } from "@/services/gyms";

const STATUS_LABEL_KEY: Record<string, string> = {
  pending: "gyms.paymentRecords.status.pending",
  processing: "gyms.paymentRecords.status.processing",
  verified: "gyms.paymentRecords.status.verified",
  flagged: "gyms.paymentRecords.status.flagged",
};

// Same cap and windowing as GymMembersTable's own pager -- duplicated rather
// than shared, following this page's existing convention of each component
// owning its own small helpers (no shared UI package between the two apps,
// and no utils module introduced for two call sites).
const MAX_PAGE_BUTTONS = 7;

function pageButtonRange(current: number, total: number): number[] {
  if (total <= MAX_PAGE_BUTTONS) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  const half = Math.floor(MAX_PAGE_BUTTONS / 2);
  let start = Math.max(1, current - half);
  const end = Math.min(total, start + MAX_PAGE_BUTTONS - 1);
  start = Math.max(1, end - MAX_PAGE_BUTTONS + 1);
  return Array.from({ length: end - start + 1 }, (_, i) => start + i);
}

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
  const router = useRouter();
  const searchParams = useSearchParams();

  if (payments === null) {
    return null;
  }

  const totalPages = Math.max(1, Math.ceil(payments.total / payments.pageSize));

  function goToPage(page: number) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("ppage", String(page));
    router.push(`?${params.toString()}`);
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
          <Button variant="outline" size="sm" onClick={() => goToPage(1)}>
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

          {totalPages > 1 && (
            <div className="flex justify-center gap-2">
              <Button
                variant="outline"
                size="sm"
                aria-label={t("gyms.pagination.previous")}
                disabled={payments.page <= 1}
                onClick={() => goToPage(payments.page - 1)}
              >
                <ChevronLeft size={16} />
              </Button>
              {pageButtonRange(payments.page, totalPages).map((p) => (
                <Button
                  key={p}
                  variant={p === payments.page ? "default" : "outline"}
                  size="sm"
                  onClick={() => goToPage(p)}
                >
                  {p}
                </Button>
              ))}
              <Button
                variant="outline"
                size="sm"
                aria-label={t("gyms.pagination.next")}
                disabled={payments.page >= totalPages}
                onClick={() => goToPage(payments.page + 1)}
              >
                <ChevronRight size={16} />
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
