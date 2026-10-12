"use client";

import { useRef, useState, useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslation } from "react-i18next";

import { TablePagination } from "@/components/TablePagination";
import { useUrlPagination } from "@/hooks/use-table-pagination";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { PaymentLedgerRow } from "@/services/payments";
import {
  PAYMENT_FLAGGED_REASON_LABEL_KEY,
  PAYMENT_METHOD_LABEL_KEY,
  PAYMENT_PURPOSE_LABEL_KEY,
  PAYMENT_STATUS_BADGE_CONFIG,
  type PaymentStatus,
} from "../paymentLabels";
import { exportPaymentsCsvAction } from "../actions";

export interface PaymentsLedgerData {
  rows: PaymentLedgerRow[];
  total: number;
  page: number;
  pageSize: number;
}

// Filter value -> label key. `subscription` is offered as "Renewal".
const PURPOSE_FILTER_OPTIONS: { value: string; labelKey: string }[] = [
  { value: "", labelKey: "payments.purposeFilter.all" },
  { value: "subscription", labelKey: "payments.purposeFilter.renewal" },
  { value: "registration_fee", labelKey: "payments.purposeFilter.registrationFee" },
  { value: "session", labelKey: "payments.purposeFilter.session" },
];

/**
 * Story 19.9c: the minimal All Payments ledger (AD-09). Filters and page live in
 * the URL; the server page re-reads them. Purpose and member filters only.
 */
export function PaymentsLedger({
  ledger,
  hasError,
  purpose,
  memberId,
}: {
  ledger: PaymentsLedgerData | null;
  hasError: boolean;
  purpose: string;
  memberId: string;
}) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const pagination = useUrlPagination();

  const [exporting, setExporting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const filtered = Boolean(purpose || memberId);

  function setPurpose(next: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (next) params.set("purpose", next);
    else params.delete("purpose");
    params.set("page", "1");
    router.push(`${pathname}?${params.toString()}`);
  }

  function clearFilters() {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("purpose");
    params.delete("memberId");
    params.set("page", "1");
    router.push(`${pathname}?${params.toString()}`);
  }

  function showMessage(text: string) {
    setMessage(text);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setMessage(null), 4000);
  }

  async function handleExport() {
    setExporting(true);
    try {
      const { data, error } = await exportPaymentsCsvAction({
        purpose: purpose || undefined,
        memberId: memberId || undefined,
      });
      if (error) {
        showMessage(error.message);
        return;
      }
      if (data !== null) {
        const blob = new Blob([data], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = "payments.csv";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      }
    } catch {
      showMessage(t("common.somethingWentWrong"));
    } finally {
      setExporting(false);
    }
  }

  function formatDate(iso: string): string {
    return new Date(iso).toLocaleString(i18n.language, { dateStyle: "short", timeStyle: "short" });
  }

  function actorLabel(row: PaymentLedgerRow): string {
    if (row.actorName) return row.actorName;
    if (row.method === "mobile_money") return t("payments.ledger.actorTara");
    return "—";
  }

  function reasonKey(row: PaymentLedgerRow): string | null {
    if (!row.flaggedReason) return null;
    // A verified payment only keeps a tag for the late confirmation; any other
    // reason belongs to a payment that is still flagged.
    if (row.status === "verified" && row.flaggedReason !== "late_confirmation") return null;
    return PAYMENT_FLAGGED_REASON_LABEL_KEY[row.flaggedReason] ?? null;
  }

  return (
    <section className="space-y-2" aria-label={t("payments.ledger.title")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">{t("payments.ledger.title")}</h2>
        <Button variant="outline" onClick={handleExport} disabled={exporting || hasError}>
          {exporting ? t("payments.export.exporting") : t("payments.export.button")}
        </Button>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <label htmlFor="paymentsPurposeFilter" className="text-sm text-muted-foreground">
            {t("payments.purposeFilter.label")}
          </label>
          <select
            id="paymentsPurposeFilter"
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
            className="flex h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            {PURPOSE_FILTER_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {t(option.labelKey)}
              </option>
            ))}
          </select>
        </div>
        {filtered && (hasError || !ledger || ledger.rows.length > 0) && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            {t("payments.ledger.clearFilters")}
          </Button>
        )}
      </div>

      {hasError || !ledger ? (
        <div className="rounded-md border border-dashed py-8 text-center text-sm text-red-600">
          {t("payments.ledger.loadError")}
        </div>
      ) : ledger.rows.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-md border border-dashed py-12 text-center">
          <p className="text-sm text-muted-foreground">
            {filtered ? t("payments.ledger.emptyFiltered") : t("payments.ledger.empty")}
          </p>
          {filtered && (
            <Button variant="outline" size="sm" onClick={clearFilters}>
              {t("payments.ledger.clearFilters")}
            </Button>
          )}
        </div>
      ) : (
        <>
          <TablePagination compact page={ledger.page} pageSize={ledger.pageSize} total={ledger.total} {...pagination} />
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/50 text-left">
                <tr>
                  <th className="p-3 font-medium">{t("payments.table.member")}</th>
                  <th className="p-3 font-medium">{t("payments.table.amount")}</th>
                  <th className="p-3 font-medium">{t("payments.table.method")}</th>
                  <th className="p-3 font-medium">{t("payments.ledger.table.purpose")}</th>
                  <th className="p-3 font-medium">{t("payments.table.status")}</th>
                  <th className="p-3 font-medium">{t("payments.ledger.table.date")}</th>
                  <th className="p-3 font-medium">{t("payments.ledger.table.actor")}</th>
                  <th className="p-3 font-medium">{t("payments.ledger.table.note")}</th>
                </tr>
              </thead>
              <tbody>
                {ledger.rows.map((row) => {
                  const badge =
                    PAYMENT_STATUS_BADGE_CONFIG[row.status as PaymentStatus] ?? PAYMENT_STATUS_BADGE_CONFIG.pending;
                  const Icon = badge.icon;
                  const tagKey = reasonKey(row);
                  const purposeKey = PAYMENT_PURPOSE_LABEL_KEY[row.purpose];
                  const methodKey = PAYMENT_METHOD_LABEL_KEY[row.method];
                  return (
                    <tr key={row.id} className="border-b last:border-0">
                      <td className="p-3">{row.memberName || "—"}</td>
                      <td className="p-3">{row.amount.toLocaleString(i18n.language)}</td>
                      <td className="p-3">{methodKey ? t(methodKey) : row.method}</td>
                      <td className="p-3">{purposeKey ? t(purposeKey) : row.purpose}</td>
                      <td className="p-3">
                        <div className="flex flex-wrap items-center gap-1">
                          <Badge variant="outline" className={badge.className}>
                            <Icon size={12} className="mr-1" />
                            {t(badge.labelKey)}
                          </Badge>
                          {tagKey && <span className="text-xs text-muted-foreground">{t(tagKey)}</span>}
                          {row.voidedAt && (
                            <span className="text-xs text-muted-foreground">{t("payments.ledger.voided")}</span>
                          )}
                        </div>
                      </td>
                      <td className="p-3">{formatDate(row.createdAt)}</td>
                      <td className="p-3">{actorLabel(row)}</td>
                      <td className="p-3 max-w-xs truncate" title={row.note ?? ""}>
                        {row.note ?? "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <TablePagination page={ledger.page} pageSize={ledger.pageSize} total={ledger.total} {...pagination} />
        </>
      )}

      {message && (
        <div role="status" className="text-sm text-red-600">
          {message}
        </div>
      )}
    </section>
  );
}
