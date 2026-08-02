"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight, ArrowUp, ArrowDown, RotateCw } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RenewalModal } from "@/components/shared/RenewalModal";
import type { SubscriptionListRow } from "@/services/subscriptions";
import { PLAN_TYPE_LABEL_KEY } from "@/app/(dashboard)/plans/planLabels";
import { exportSubscriptionsCsvAction } from "../actions";
import { STATUS_BADGE_CONFIG } from "../subscriptionLabels";

const STATUS_OPTIONS = ["", "active", "expiring_soon", "grace_period", "expired"] as const;
const STATUS_LABEL_KEY: Record<(typeof STATUS_OPTIONS)[number], string> = {
  "": "subscriptions.statusAll",
  active: "members.status.active",
  expiring_soon: "members.status.expiringSoon",
  grace_period: "members.status.gracePeriod",
  expired: "members.status.expired",
};

const PLAN_TYPE_OPTIONS = ["", "pay_per_session", "monthly", "coach_inclusive", "class_only"] as const;

const SORT_COLUMNS = [
  { key: "name", labelKey: "subscriptions.table.member" },
  { key: "status", labelKey: "subscriptions.table.status" },
  { key: "expiry", labelKey: "subscriptions.table.expiry" },
] as const;

// Windows the page-number buttons around the current page -- copied
// per-file from MembersPageClient.tsx's own pageWindow()/PAGE_WINDOW_RADIUS
// (attendance's AttendancePageClient.tsx already established this same
// per-file-copy precedent for the identical helper).
const PAGE_WINDOW_RADIUS = 2;

function pageWindow(current: number, total: number): (number | "ellipsis")[] {
  if (total <= 1) return total === 1 ? [1] : [];

  const middle: number[] = [];
  for (
    let p = Math.max(2, current - PAGE_WINDOW_RADIUS);
    p <= Math.min(total - 1, current + PAGE_WINDOW_RADIUS);
    p++
  ) {
    middle.push(p);
  }

  const result: (number | "ellipsis")[] = [1];
  if (middle[0] > 2) result.push("ellipsis");
  result.push(...middle);
  if (middle[middle.length - 1] < total - 1) result.push("ellipsis");
  result.push(total);
  return result;
}

// MembersPageClient.tsx's exact local-date-parsing pattern -- avoids the
// UTC-shift bug from parsing a "YYYY-MM-DD" string via `new Date(string)`
// directly.
function formatLocalDate(dateOnly: string, locale: string): string {
  const [year, month, day] = dateOnly.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(locale);
}

export function SubscriptionsPageClient({
  initialSubscriptions,
  total,
  page,
  pageSize,
  status,
  planType,
  sort,
  dir,
}: {
  initialSubscriptions: SubscriptionListRow[];
  total: number;
  page: number;
  pageSize: number;
  status: string;
  planType: string;
  sort: string;
  dir: string;
}) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [renewingRow, setRenewingRow] = useState<SubscriptionListRow | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  function updateParams(next: {
    status?: string;
    planType?: string;
    sort?: string;
    dir?: string;
    page?: number;
  }) {
    const params = new URLSearchParams(searchParams.toString());
    if (next.status !== undefined) {
      if (next.status) params.set("status", next.status);
      else params.delete("status");
    }
    if (next.planType !== undefined) {
      if (next.planType) params.set("planType", next.planType);
      else params.delete("planType");
    }
    if (next.sort !== undefined) params.set("sort", next.sort);
    if (next.dir !== undefined) params.set("dir", next.dir);
    params.set("page", String(next.page ?? 1));
    router.push(`${pathname}?${params.toString()}`);
  }

  function showToast(message: string) {
    setToast(message);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 4000);
  }

  function handleSort(column: string) {
    if (sort === column) {
      updateParams({ sort: column, dir: dir === "asc" ? "desc" : "asc", page: 1 });
    } else {
      updateParams({ sort: column, dir: "asc", page: 1 });
    }
  }

  async function handleExport() {
    setExporting(true);
    try {
      const { data, error } = await exportSubscriptionsCsvAction({ status, planType });
      if (error) {
        showToast(error.message);
        return;
      }
      if (data) {
        const blob = new Blob([data], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = "subscriptions.csv";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      }
    } catch {
      showToast(t("common.somethingWentWrong"));
    } finally {
      setExporting(false);
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  function expiryLabel(row: SubscriptionListRow): string {
    if (!row.expiryDate) return "—";
    return formatLocalDate(row.expiryDate, i18n.language);
  }

  function planTypeLabel(row: SubscriptionListRow): string {
    const key = PLAN_TYPE_LABEL_KEY[row.planType as keyof typeof PLAN_TYPE_LABEL_KEY];
    return key ? t(key) : row.planType;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t("subscriptions.title")}</h1>
        <Button variant="outline" onClick={handleExport} disabled={exporting}>
          {exporting ? t("subscriptions.export.exporting") : t("subscriptions.export.button")}
        </Button>
      </div>

      <div className="flex gap-4">
        <div className="flex flex-col gap-1">
          <Label htmlFor="subscriptionsStatusFilter">{t("subscriptions.filters.status")}</Label>
          <select
            id="subscriptionsStatusFilter"
            value={status}
            onChange={(e) => updateParams({ status: e.target.value, page: 1 })}
            className="flex h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {t(STATUS_LABEL_KEY[s])}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="subscriptionsPlanTypeFilter">{t("subscriptions.filters.planType")}</Label>
          <select
            id="subscriptionsPlanTypeFilter"
            value={planType}
            onChange={(e) => updateParams({ planType: e.target.value, page: 1 })}
            className="flex h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <option value="">{t("subscriptions.filters.planTypeAll")}</option>
            {PLAN_TYPE_OPTIONS.filter((p) => p).map((p) => (
              <option key={p} value={p}>
                {t(PLAN_TYPE_LABEL_KEY[p as keyof typeof PLAN_TYPE_LABEL_KEY])}
              </option>
            ))}
          </select>
        </div>
      </div>

      {initialSubscriptions.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-md border border-dashed py-16 text-center">
          {total === 0 && !status && !planType ? (
            <p className="text-sm text-muted-foreground">{t("subscriptions.emptyNoSubscriptions")}</p>
          ) : (
            <p className="text-sm text-muted-foreground">{t("subscriptions.emptyFilterNoMatch")}</p>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/50 text-left">
              <tr>
                {SORT_COLUMNS.map((col) => (
                  <th
                    key={col.key}
                    className="p-3 font-medium"
                    aria-sort={sort === col.key ? (dir === "asc" ? "ascending" : "descending") : "none"}
                  >
                    <button
                      type="button"
                      onClick={() => handleSort(col.key)}
                      className="flex items-center gap-1 hover:text-foreground"
                    >
                      {t(col.labelKey)}
                      {sort === col.key && (dir === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
                    </button>
                  </th>
                ))}
                <th className="p-3 font-medium">{t("subscriptions.table.plan")}</th>
                <th className="p-3 font-medium">{t("subscriptions.table.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {initialSubscriptions.map((row) => {
                const badge = STATUS_BADGE_CONFIG[row.status];
                const Icon = badge.icon;
                return (
                  <tr key={row.subscriptionId} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">
                          {row.memberName.slice(0, 1).toUpperCase()}
                        </div>
                        {row.memberName}
                      </div>
                    </td>
                    <td className="p-3">
                      <Badge variant="outline" className={badge.className}>
                        <Icon size={12} className="mr-1" />
                        {t(badge.labelKey)}
                      </Badge>
                    </td>
                    <td className="p-3">{expiryLabel(row)}</td>
                    <td className="p-3">{planTypeLabel(row)}</td>
                    <td className="p-3">
                      {row.status !== "active" ? (
                        <Button
                          variant="outline"
                          size="sm"
                          className="border-green-200 text-green-700 hover:bg-green-50 hover:text-green-800"
                          onClick={() => setRenewingRow(row)}
                        >
                          <RotateCw size={14} />
                          {t("subscriptions.actions.renew")}
                        </Button>
                      ) : (
                        "–"
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            aria-label={t("subscriptions.pagination.previous")}
            disabled={page <= 1}
            onClick={() => updateParams({ page: page - 1 })}
          >
            <ChevronLeft size={16} />
          </Button>
          {pageWindow(page, totalPages).map((p, i) =>
            p === "ellipsis" ? (
              <span key={`ellipsis-${i}`} className="px-2 text-sm text-muted-foreground">
                {t("subscriptions.pagination.ellipsis")}
              </span>
            ) : (
              <Button
                key={p}
                variant={p === page ? "default" : "outline"}
                size="sm"
                onClick={() => updateParams({ page: p })}
              >
                {p}
              </Button>
            ),
          )}
          <Button
            variant="outline"
            size="sm"
            aria-label={t("subscriptions.pagination.next")}
            disabled={page >= totalPages}
            onClick={() => updateParams({ page: page + 1 })}
          >
            <ChevronRight size={16} />
          </Button>
        </div>
      )}

      {renewingRow && (
        <RenewalModal
          memberId={renewingRow.memberId}
          memberName={renewingRow.memberName}
          originalExpiryDate={
            (renewingRow.status === "grace_period" || renewingRow.status === "expired") && renewingRow.expiryDate
              ? renewingRow.expiryDate
              : undefined
          }
          onClose={() => setRenewingRow(null)}
          onRenewed={() => {
            setRenewingRow(null);
            router.refresh();
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
