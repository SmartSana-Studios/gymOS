"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight, ChevronDown, ChevronUp } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { GymBillingRow } from "@/services/billing";
import { GymLifecycleDialog } from "../../gyms/components/GymLifecycleDialog";
// suspendGym/reinstateGym are imported directly from gyms/actions.ts (not
// re-exported through billing/actions.ts) -- a "use server" module can only
// export locally-declared async functions; Next.js's RSC compiler rejects a
// bare `export { x } from "other-module"` re-export in such a file (Story
// 1.6's <GymLifecycleDialog>/suspendGym/reinstateGym are still reused
// unchanged, per this story's own Dev Notes, just imported at their
// original source instead of proxied).
import { suspendGym, reinstateGym } from "../../gyms/actions";
import { markPaymentReceived, applyCredit, triggerRetry } from "../actions";
import { MarkPaymentReceivedDialog } from "./MarkPaymentReceivedDialog";
import { ApplyCreditDialog } from "./ApplyCreditDialog";
import { TriggerRetryDialog } from "./TriggerRetryDialog";

const STATUS_OPTIONS = ["", "active", "past_due", "grace_period", "suspended"] as const;
const STATUS_LABEL_KEY: Record<(typeof STATUS_OPTIONS)[number], string> = {
  "": "billing.statusAll",
  active: "billing.status.active",
  past_due: "billing.status.past_due",
  grace_period: "billing.status.grace_period",
  suspended: "billing.status.suspended",
};

// SA-07: Active = green, Past due = amber, Grace period = orange,
// Suspended = red -- same badge visual language as member subscription
// status elsewhere in the product.
const STATUS_BADGE_CLASS: Record<string, string> = {
  active: "border-green-200 bg-green-50 text-green-700",
  past_due: "border-amber-200 bg-amber-50 text-amber-700",
  grace_period: "border-orange-200 bg-orange-50 text-orange-700",
  suspended: "border-red-200 bg-red-50 text-red-700",
};

type DialogState =
  | { type: "markPaymentReceived"; row: GymBillingRow }
  | { type: "applyCredit"; row: GymBillingRow }
  | { type: "triggerRetry"; row: GymBillingRow }
  | { type: "lifecycle"; row: GymBillingRow; action: "suspend" | "reinstate" }
  | null;

export function BillingPageClient({
  initialRows,
  total,
  page,
  pageSize,
  search,
  status,
}: {
  initialRows: GymBillingRow[];
  total: number;
  page: number;
  pageSize: number;
  search: string;
  status: string;
}) {
  const [searchInput, setSearchInput] = useState(search);
  const [expandedGymId, setExpandedGymId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [toast, setToast] = useState<string | null>(null);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { t } = useTranslation();

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSearchInput(search);
  }, [search]);

  function updateParams(next: { search?: string; status?: string; page?: number }) {
    const params = new URLSearchParams(searchParams.toString());
    if (next.search !== undefined) {
      if (next.search) params.set("search", next.search);
      else params.delete("search");
    }
    if (next.status !== undefined) {
      if (next.status) params.set("status", next.status);
      else params.delete("status");
    }
    params.set("page", String(next.page ?? 1));
    router.push(`${pathname}?${params.toString()}`);
  }

  function showToast(message: string) {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast(message);
    toastTimerRef.current = setTimeout(() => setToast(null), 4000);
  }

  function closeDialogAndRefresh(message?: string) {
    setDialog(null);
    if (message) showToast(message);
    router.refresh();
  }

  // Review fix: `value` is a bare "YYYY-MM-DD" date column (saas_billing_anchor_date /
  // last-payment date) -- `new Date(value)` parses it as UTC midnight, which then
  // renders a day early for a negative-UTC-offset viewer. Mirrors this codebase's own
  // established fix (apps/dashboard/app/(dashboard)/settings/SettingsForm.tsx's
  // formatLocalDate()): build the Date from local Y/M/D components instead.
  function formatDate(value: string | null): string {
    if (!value) return t("billing.noValue");
    const [year, month, day] = value.split("-").map(Number);
    return new Date(year, month - 1, day).toLocaleDateString();
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t("billing.title")}</h1>
      </div>

      <div className="flex gap-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor="billingSearch" className="invisible">
            {t("billing.searchPlaceholder")}
          </Label>
          <Input
            id="billingSearch"
            placeholder={t("billing.searchPlaceholder")}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") updateParams({ search: searchInput, page: 1 });
            }}
            className="max-w-xs"
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="billingStatusFilter">{t("billing.filters.status")}</Label>
          <select
            id="billingStatusFilter"
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
        <div className="flex flex-col justify-end">
          <Button variant="outline" onClick={() => updateParams({ search: searchInput, page: 1 })}>
            {t("gyms.search")}
          </Button>
        </div>
      </div>

      {initialRows.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-md border border-dashed py-16 text-center">
          <p className="text-sm text-muted-foreground">
            {total === 0 && !search && !status ? t("billing.emptyNoGyms") : t("billing.emptyNoMatch")}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/50 text-left">
              <tr>
                <th className="p-3 font-medium" />
                <th className="p-3 font-medium">{t("billing.table.gym")}</th>
                <th className="p-3 font-medium">{t("billing.table.tier")}</th>
                <th className="p-3 font-medium">{t("billing.table.interval")}</th>
                <th className="p-3 font-medium">{t("billing.table.status")}</th>
                <th className="p-3 font-medium">{t("billing.table.nextBilling")}</th>
                <th className="p-3 font-medium">{t("billing.table.lastPayment")}</th>
                <th className="p-3 font-medium">{t("billing.table.failed")}</th>
              </tr>
            </thead>
            <tbody>
              {initialRows.map((row) => {
                const expanded = expandedGymId === row.id;
                return (
                  <Fragment key={row.id}>
                    <tr
                      className="cursor-pointer border-b last:border-0 hover:bg-muted/30"
                      onClick={() => setExpandedGymId(expanded ? null : row.id)}
                    >
                      <td className="p-3">
                        {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                      </td>
                      <td className="p-3">{row.name}</td>
                      <td className="p-3">{row.tierName}</td>
                      <td className="p-3">
                        {row.saasBillingInterval
                          ? t(`billing.interval.${row.saasBillingInterval}`)
                          : t("billing.noValue")}
                      </td>
                      <td className="p-3">
                        <span
                          className={`inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold ${STATUS_BADGE_CLASS[row.saasBillingStatus] ?? ""}`}
                        >
                          {t(STATUS_LABEL_KEY[row.saasBillingStatus as (typeof STATUS_OPTIONS)[number]] ?? "billing.statusUnknown")}
                        </span>
                      </td>
                      <td className="p-3">{formatDate(row.nextBillingDate)}</td>
                      <td className="p-3">{formatDate(row.lastPaymentDate)}</td>
                      <td className="p-3">{row.failedAttemptCount}</td>
                    </tr>
                    {expanded && (
                      <tr key={`${row.id}-expanded`} className="border-b bg-muted/20 last:border-0">
                        <td colSpan={8} className="p-3">
                          <div className="flex flex-wrap gap-2" onClick={(e) => e.stopPropagation()}>
                            <Button size="sm" variant="outline" onClick={() => setDialog({ type: "markPaymentReceived", row })}>
                              {t("billing.actions.markPaymentReceived")}
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => setDialog({ type: "applyCredit", row })}>
                              {t("billing.actions.applyCredit")}
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => setDialog({ type: "triggerRetry", row })}>
                              {t("billing.actions.triggerRetry")}
                            </Button>
                            {/* Review fix: GymsPageClient.tsx branches on all three of
                                suspended/deactivated/active -- this ternary previously only
                                checked "suspended", so a deactivated gym fell into the else
                                branch and showed "Suspend", which would have transitioned
                                gyms.status from deactivated straight to suspended. Reinstate
                                is the correct action for both suspended and deactivated,
                                mirroring GymsPageClient's own deactivated-row handling. */}
                            {row.status === "suspended" || row.status === "deactivated" ? (
                              <Button
                                size="sm"
                                variant="outline"
                                className="border-green-200 text-green-700 hover:bg-green-50 hover:text-green-800"
                                onClick={() => setDialog({ type: "lifecycle", row, action: "reinstate" })}
                              >
                                {t("billing.actions.reinstate")}
                              </Button>
                            ) : (
                              <Button
                                size="sm"
                                variant="outline"
                                className="border-orange-200 text-orange-700 hover:bg-orange-50 hover:text-orange-800"
                                onClick={() => setDialog({ type: "lifecycle", row, action: "suspend" })}
                              >
                                {t("billing.actions.suspend")}
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
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
            aria-label={t("gyms.pagination.previous")}
            disabled={page <= 1}
            onClick={() => updateParams({ page: page - 1 })}
          >
            <ChevronLeft size={16} />
          </Button>
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
            <Button
              key={p}
              variant={p === page ? "default" : "outline"}
              size="sm"
              onClick={() => updateParams({ page: p })}
            >
              {p}
            </Button>
          ))}
          <Button
            variant="outline"
            size="sm"
            aria-label={t("gyms.pagination.next")}
            disabled={page >= totalPages}
            onClick={() => updateParams({ page: page + 1 })}
          >
            <ChevronRight size={16} />
          </Button>
        </div>
      )}

      {dialog?.type === "markPaymentReceived" && (
        <MarkPaymentReceivedDialog
          gymId={dialog.row.id}
          gymName={dialog.row.name}
          onClose={() => setDialog(null)}
          onDone={(warning) => closeDialogAndRefresh(warning ?? t("billing.toast.paymentReceived", { gymName: dialog.row.name }))}
          runAction={markPaymentReceived}
        />
      )}

      {dialog?.type === "applyCredit" && (
        <ApplyCreditDialog
          gymId={dialog.row.id}
          gymName={dialog.row.name}
          saasBillingInterval={dialog.row.saasBillingInterval}
          onClose={() => setDialog(null)}
          onDone={(warning) => closeDialogAndRefresh(warning ?? t("billing.toast.creditApplied", { gymName: dialog.row.name }))}
          runAction={applyCredit}
        />
      )}

      {dialog?.type === "triggerRetry" && (
        <TriggerRetryDialog
          gymId={dialog.row.id}
          gymName={dialog.row.name}
          onClose={() => setDialog(null)}
          onDone={(warning) => closeDialogAndRefresh(warning ?? t("billing.toast.retryTriggered", { gymName: dialog.row.name }))}
          runAction={triggerRetry}
        />
      )}

      {dialog?.type === "lifecycle" && (
        // <GymLifecycleDialog> is reused unchanged (Story 1.6) -- its `gym`
        // prop is narrowed to Pick<GymListRow, "id" | "name" | "status">
        // (review fix), so GymBillingRow's own {id, name, status} subset
        // satisfies it directly with no cast.
        <GymLifecycleDialog
          gym={{ id: dialog.row.id, name: dialog.row.name, status: dialog.row.status }}
          action={dialog.action}
          onClose={() => setDialog(null)}
          onDone={(warning) => closeDialogAndRefresh(warning)}
          runAction={dialog.action === "suspend" ? suspendGym : reinstateGym}
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
