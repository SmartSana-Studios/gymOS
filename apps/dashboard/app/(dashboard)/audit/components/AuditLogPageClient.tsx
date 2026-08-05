"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { AuditLogRow, AuditActorOption } from "@/services/auditLog";
import type { MemberRole } from "@/services/session";
import { AUDIT_ACTION_TYPE_LABEL_KEY } from "../auditLabels";
import { exportAuditLogCsvAction } from "../actions";

// Windows the page-number buttons around the current page -- copied
// per-file from SubscriptionsPageClient.tsx's own pageWindow()/
// PAGE_WINDOW_RADIUS, this codebase's established per-file-copy discipline
// for this helper (not a shared import).
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

function actionLabel(t: (key: string) => string, actionType: string): string {
  const key = AUDIT_ACTION_TYPE_LABEL_KEY[actionType];
  return key ? t(key) : actionType;
}

// Dev Notes scope decision: never live-join to a resolved display name --
// target_entity_id is deliberately not a foreign key (the log must survive
// even if the target row is later deleted). Render type + raw id, truncated.
function targetLabel(row: AuditLogRow): string {
  if (!row.targetEntityType && !row.targetEntityId) return "—";
  const id = row.targetEntityId ? `${row.targetEntityId.slice(0, 8)}…` : "—";
  return `${row.targetEntityType ?? "—"} · ${id}`;
}

// Every metadata shape produced by this codebase's write call sites is a
// flat, single-level object, but a defensive fallback covers a value that
// ever isn't (rather than risking a bare "[object Object]" in the UI).
function detailsLabel(metadata: Record<string, unknown>): string {
  const entries = Object.entries(metadata);
  if (entries.length === 0) return "—";
  return entries
    .map(([key, value]) => `${key}: ${value !== null && typeof value === "object" ? JSON.stringify(value) : String(value)}`)
    .join(", ");
}

function formatTimestamp(iso: string, locale: string): string {
  return new Date(iso).toLocaleString(locale);
}

export function AuditLogPageClient({
  initialRows,
  total,
  page,
  pageSize,
  from,
  to,
  actorId,
  role,
  actorOptions,
}: {
  initialRows: AuditLogRow[];
  total: number;
  page: number;
  pageSize: number;
  from: string;
  to: string;
  actorId: string;
  role: MemberRole;
  actorOptions: AuditActorOption[];
}) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [toast, setToast] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  function updateParams(next: { from?: string; to?: string; actorId?: string; page?: number }) {
    const params = new URLSearchParams(searchParams.toString());
    if (next.from !== undefined) params.set("from", next.from);
    if (next.to !== undefined) params.set("to", next.to);
    if (next.actorId !== undefined) {
      if (next.actorId) params.set("actorId", next.actorId);
      else params.delete("actorId");
    }
    params.set("page", String(next.page ?? 1));
    router.push(`${pathname}?${params.toString()}`);
  }

  function showToast(message: string) {
    setToast(message);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 4000);
  }

  async function handleExport() {
    setExporting(true);
    try {
      const { data, error } = await exportAuditLogCsvAction({ from, to, actorId: actorId || undefined });
      if (error) {
        showToast(error.message);
        return;
      }
      if (data) {
        const blob = new Blob([data], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = "audit-log.csv";
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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t("audit.title")}</h1>
        {role === "owner" && (
          <Button variant="outline" onClick={handleExport} disabled={exporting}>
            {exporting ? t("audit.export.exporting") : t("audit.export.button")}
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <label htmlFor="auditFrom" className="text-sm text-muted-foreground">
            {t("audit.filters.dateFrom")}
          </label>
          <input
            id="auditFrom"
            type="date"
            value={from}
            // Clearing a native date input emits "", not undefined -- fall
            // back to the current known-good value instead of pushing an
            // empty string as the URL param (AttendancePageClient.tsx's own
            // precedent).
            onChange={(e) => updateParams({ from: e.target.value || from, to, page: 1 })}
            className="flex h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="auditTo" className="text-sm text-muted-foreground">
            {t("audit.filters.dateTo")}
          </label>
          <input
            id="auditTo"
            type="date"
            value={to}
            onChange={(e) => updateParams({ from, to: e.target.value || to, page: 1 })}
            className="flex h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="auditActorFilter" className="text-sm text-muted-foreground">
            {t("audit.filters.actor")}
          </label>
          <select
            id="auditActorFilter"
            value={actorId}
            onChange={(e) => updateParams({ actorId: e.target.value, page: 1 })}
            className="flex h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <option value="">{t("audit.filters.actorAll")}</option>
            {actorOptions.map((actor) => (
              <option key={actor.actorId} value={actor.actorId}>
                {actor.actorDisplayName}
              </option>
            ))}
          </select>
        </div>
      </div>

      {initialRows.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-md border border-dashed py-16 text-center">
          <p className="text-sm text-muted-foreground">{t("audit.emptyNoRecords")}</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/50 text-left">
              <tr>
                <th className="p-3 font-medium">{t("audit.table.timestamp")}</th>
                <th className="p-3 font-medium">{t("audit.table.actor")}</th>
                <th className="p-3 font-medium">{t("audit.table.action")}</th>
                <th className="p-3 font-medium">{t("audit.table.target")}</th>
                <th className="p-3 font-medium">{t("audit.table.details")}</th>
              </tr>
            </thead>
            <tbody>
              {initialRows.map((row) => (
                <tr key={row.id} className="border-b last:border-0">
                  <td className="p-3">{formatTimestamp(row.createdAt, i18n.language)}</td>
                  <td className="p-3">{row.actorDisplayName}</td>
                  <td className="p-3">{actionLabel(t, row.actionType)}</td>
                  <td className="p-3">{targetLabel(row)}</td>
                  <td className="p-3">{detailsLabel(row.metadata)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            aria-label={t("audit.pagination.previous")}
            disabled={page <= 1}
            onClick={() => updateParams({ page: page - 1 })}
          >
            <ChevronLeft size={16} />
          </Button>
          {pageWindow(page, totalPages).map((p, i) =>
            p === "ellipsis" ? (
              <span key={`ellipsis-${i}`} className="px-2 text-sm text-muted-foreground">
                {t("audit.pagination.ellipsis")}
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
            aria-label={t("audit.pagination.next")}
            disabled={page >= totalPages}
            onClick={() => updateParams({ page: page + 1 })}
          >
            <ChevronRight size={16} />
          </Button>
        </div>
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
