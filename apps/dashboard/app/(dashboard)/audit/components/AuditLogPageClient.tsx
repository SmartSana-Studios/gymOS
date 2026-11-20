"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TablePagination } from "@/components/TablePagination";
import { useUrlPagination } from "@/hooks/use-table-pagination";
import type { AuditLogRow, AuditActorOption } from "@/services/auditLog";
import type { DisclosureRequest } from "@/services/auditDisclosure";
import type { MemberRole } from "@/services/session";
import { AUDIT_ACTION_TYPE_LABEL_KEY } from "../auditLabels";
import { exportAuditLogCsvAction } from "../actions";
import { DisclosureRequestDialog } from "./DisclosureRequestDialog";
import { DisclosureRequestsPanel } from "./DisclosureRequestsPanel";
import { formatDayMonthYear } from "@/lib/dayMonth";
import { summarizeSlots } from "@/lib/classTimes";

function actionLabel(
  t: (key: string) => string,
  actionType: string,
  metadata: Record<string, unknown> = {},
): string {
  // Story 20.3 writes the subscriber reward under the same action type as the
  // guest one; the counter in metadata tells them apart (auditLabels.ts).
  if (actionType === "loyalty_reward_granted" && metadata.counter === "subscriber") {
    return t("audit.actionTypes.loyaltyRewardDaysGranted");
  }
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

// Story 27.3 (UX AD-12 V1.8): the three staff check-in rows read in plain words -- the time and outcome ("Checked in with a warning"
// for Expiring Soon and Grace Period), the reason code of a refusal, the original entry time and reason of a void -- instead of the
// generic `key: value` list. Anything unexpected falls back to the generic cell, so a row never renders empty.
function staffCheckInDetails(
  t: (key: string, options?: Record<string, unknown>) => string,
  actionType: string,
  metadata: Record<string, unknown>,
  locale: string,
): string | null {
  const time = (value: unknown) =>
    typeof value === "string" ? new Date(value).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", hour12: false }) : null;
  if (actionType === "staff_check_in") {
    const at = time(metadata.checked_in_at);
    if (!at) return null;
    return t(metadata.outcome === "checked_in_with_warning" ? "audit.staffCheckIn.checkedInWarning" : "audit.staffCheckIn.checkedIn", { time: at });
  }
  if (actionType === "staff_check_in_rejected") {
    const reason = metadata.reason;
    return typeof reason === "string" ? t(`audit.staffCheckIn.reason.${reason}`) : null;
  }
  if (actionType === "staff_check_in_voided") {
    const at = time(metadata.original_checked_in_at);
    return at && typeof metadata.reason === "string" ? t("audit.staffCheckIn.voided", { time: at, reason: metadata.reason }) : null;
  }
  return null;
}

// Story 27.4 (UX AD-12 V1.8): "Annual → Monthly · 250,000 → 25,000 XAF · expires 02 Nov 2027 → 02 Dec 2026 · Reason: ..." -- both plans,
// both prices, both expiries and the reason in the one row. A Pay-per-session side has no expiry ("no expiry"). Anything unexpected falls
// back to the generic cell.
function planCorrectionDetails(
  t: (key: string, options?: Record<string, unknown>) => string,
  metadata: Record<string, unknown>,
  locale: string,
): string | null {
  const { old_plan_name, new_plan_name, old_price, new_price, old_expiry_date, new_expiry_date, reason } = metadata;
  if (typeof old_plan_name !== "string" || typeof new_plan_name !== "string" || typeof reason !== "string") return null;
  if (typeof old_price !== "number" || typeof new_price !== "number") return null;
  const date = (value: unknown): string => {
    if (typeof value !== "string") return t("audit.planCorrection.noExpiry");
    return formatDayMonthYear(value, locale);
  };
  return t("audit.planCorrection.details", {
    oldPlan: old_plan_name,
    newPlan: new_plan_name,
    oldPrice: old_price.toLocaleString(locale),
    newPrice: new_price.toLocaleString(locale),
    expiry: t("audit.planCorrection.expiry", { old: date(old_expiry_date), new: date(new_expiry_date) }),
    reason,
  });
}

// Story 28.1 (UX AD-13 V1.8): "Whole day → Single use" -- the two codes in the words of the Settings radio. Any other value falls back to
// the generic cell.
function sessionValidityDetails(
  t: (key: string, options?: Record<string, unknown>) => string,
  metadata: Record<string, unknown>,
): string | null {
  const label = (value: unknown): string | null =>
    value === "whole_day" ? t("settings.sessionValidity.wholeDay") : value === "single_use" ? t("settings.sessionValidity.singleUse") : null;
  const oldLabel = label(metadata.old_validity);
  const newLabel = label(metadata.new_validity);
  if (!oldLabel || !newLabel) return null;
  return t("audit.sessionValidity.details", { old: oldLabel, new: newLabel });
}

// Story 29.2 (UX AD-12 V1.8): "SPIN · Mon 07:00 · Wed 18:30 → Mon 07:30 · Wed 18:30 · 2 sessions with bookings left unchanged" for a weekly-times
// change, and "SPIN · 8 bookings cancelled" for a cancelled class. Anything unexpected falls back to the generic cell.
function slotsFromMetadata(value: unknown): { weekday: number; startTime: string }[] | null {
  if (!Array.isArray(value)) return null;
  const slots: { weekday: number; startTime: string }[] = [];
  for (const item of value) {
    const entry = item as { weekday?: unknown; start_time?: unknown } | null;
    if (!entry || typeof entry.weekday !== "number" || typeof entry.start_time !== "string") return null;
    slots.push({ weekday: entry.weekday, startTime: entry.start_time.slice(0, 5) });
  }
  return slots;
}

function classDetails(
  t: (key: string, options?: Record<string, unknown>) => string,
  actionType: string,
  metadata: Record<string, unknown>,
): string | null {
  const name = metadata.class_name;
  if (typeof name !== "string") return null;
  if (actionType === "class_cancelled") {
    const n = metadata.bookings_cancelled;
    return typeof n === "number" ? t("audit.classCancelled.details", { name, count: n }) : null;
  }
  if (actionType === "class_times_changed") {
    const oldSlots = slotsFromMetadata(metadata.old_slots);
    const newSlots = slotsFromMetadata(metadata.new_slots);
    const left = metadata.left_unchanged_count;
    if (!oldSlots || !newSlots || typeof left !== "number") return null;
    const describe = (slots: { weekday: number; startTime: string }[]) =>
      slots.length === 0 ? t("classes.modal.oneOff") : summarizeSlots(slots, t).full;
    return t("audit.classTimes.details", { name, old: describe(oldSlots), new: describe(newSlots), count: left });
  }
  return null;
}

function formatTimestamp(iso: string, locale: string): string {
  return new Date(iso).toLocaleString(locale);
}

export const AUDIT_TABS = ["log", "questions"] as const;
type AuditTab = (typeof AUDIT_TABS)[number];

function parseTab(value: string | null | undefined): AuditTab {
  return (AUDIT_TABS as readonly string[]).includes(value ?? "") ? (value as AuditTab) : "log";
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
  disclosureRequests = [],
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
  /** Story 23.8: the Owner's own questions about audit entries (empty for every other role). */
  disclosureRequests?: DisclosureRequest[];
}) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const pagination = useUrlPagination();
  const [tab, setTab] = useState<AuditTab>(parseTab(searchParams?.get("tab")));

  function selectTab(value: string) {
    const next = parseTab(value);
    setTab(next);
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    params.set("tab", next);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  const [toast, setToast] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [askAbout, setAskAbout] = useState<string | null>(null);
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

      <Tabs value={tab} onValueChange={selectTab}>
        <TabsList>
          <TabsTrigger value="log">{t("audit.tabs.log")}</TabsTrigger>
          <TabsTrigger value="questions">{t("audit.tabs.questions")}</TabsTrigger>
        </TabsList>
        <TabsContent value="log" className="space-y-4">
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

      <TablePagination compact page={page} pageSize={pageSize} total={total} {...pagination} />

      {initialRows.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-md border border-dashed py-16 text-center">
          <p className="text-sm text-muted-foreground">{t("audit.emptyNoRecords")}</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border bg-card">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/50 text-left">
              <tr>
                <th className="p-3 font-medium">{t("audit.table.timestamp")}</th>
                <th className="p-3 font-medium">{t("audit.table.actor")}</th>
                <th className="p-3 font-medium">{t("audit.table.action")}</th>
                <th className="p-3 font-medium">{t("audit.table.target")}</th>
                <th className="p-3 font-medium">{t("audit.table.details")}</th>
                {role === "owner" && <th className="p-3 font-medium"><span className="sr-only">{t("audit.disclosure.request")}</span></th>}
              </tr>
            </thead>
            <tbody>
              {initialRows.map((row) => (
                <tr key={row.id} className="border-b last:border-0">
                  <td className="p-3">{formatTimestamp(row.createdAt, i18n.language)}</td>
                  <td className="p-3">{row.actorDisplayName}</td>
                  <td className="p-3">{actionLabel(t, row.actionType, row.metadata)}</td>
                  <td className="p-3">{targetLabel(row)}</td>
                  <td className="p-3">{staffCheckInDetails(t, row.actionType, row.metadata, i18n.language) ??
                      (row.actionType === "subscription_plan_corrected" ? planCorrectionDetails(t, row.metadata, i18n.language) : null) ??
                      (row.actionType === "session_validity_changed" ? sessionValidityDetails(t, row.metadata) : null) ??
                      classDetails(t, row.actionType, row.metadata) ??
                      detailsLabel(row.metadata)}</td>
                  {role === "owner" && (
                    <td className="p-3">
                      <Button variant="outline" size="sm" onClick={() => setAskAbout(row.id)}>
                        {t("audit.disclosure.request")}
                      </Button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <TablePagination page={page} pageSize={pageSize} total={total} {...pagination} />
        </TabsContent>
        <TabsContent value="questions">
          <DisclosureRequestsPanel requests={disclosureRequests} />
        </TabsContent>
      </Tabs>

      {askAbout && (
        <DisclosureRequestDialog
          auditLogId={askAbout}
          onClose={() => setAskAbout(null)}
          onDone={(answerDueAt) => {
            setAskAbout(null);
            showToast(t("audit.disclosure.sent", { date: new Date(answerDueAt).toLocaleDateString(i18n.language) }));
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
