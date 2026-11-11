"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { PAGE_TAKEDOWN_REASON_LABELS, type PageTakedownReason } from "@gymos/types";

import { Ban, CheckCircle, Eye, EyeOff, XCircle } from "lucide-react";

import { Button } from "@/components/ui/button";

import { RowActions, type RowAction } from "../../support/components/RowActions";
import { SupportActionModal } from "../../support/components/SupportActionModal";
import { closePageReportsTakenDown, dismissPageReports, type PageReportRow } from "../actions";
import { TakedownDialog } from "./TakedownDialog";

interface Group {
  gymId: string;
  gymName: string;
  pageName: string;
  rows: PageReportRow[];
  firstReportedAt: string;
  dueAt: string;
  overdue: boolean;
  pageTakenDown: boolean;
}

export function groupReports(rows: PageReportRow[]): Group[] {
  const byGym = new Map<string, Group>();
  for (const r of rows) {
    const g = byGym.get(r.gymId);
    if (!g) {
      byGym.set(r.gymId, {
        gymId: r.gymId,
        gymName: r.gymName,
        pageName: r.pageName,
        rows: [r],
        firstReportedAt: r.createdAt,
        dueAt: r.dueAt,
        overdue: r.overdue,
        pageTakenDown: r.pageTakenDown,
      });
      continue;
    }
    g.rows.push(r);
    if (r.createdAt < g.firstReportedAt) g.firstReportedAt = r.createdAt;
    if (r.dueAt < g.dueAt) g.dueAt = r.dueAt;
    g.overdue = g.overdue || r.overdue;
  }
  return [...byGym.values()].sort((a, b) => (a.dueAt < b.dueAt ? -1 : a.dueAt > b.dueAt ? 1 : 0));
}

/**
 * SA-17: the report queue, one row per reported page (all its open reports), soonest due first, with an Overdue mark past the 5 business
 * days. The detail lists each report: the reason the visitor chose, their message and the time (no reporter identity exists).
 */
export function ReportsPanel({ rows }: { rows: PageReportRow[] }) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const language = i18n.language === "fr" ? "fr" : "en";
  const groups = useMemo(() => groupReports(rows), [rows]);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [dismissing, setDismissing] = useState<Group | null>(null);
  const [takingDown, setTakingDown] = useState<Group | null>(null);
  const [closing, setClosing] = useState<Group | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const fmt = (iso: string) => new Date(iso).toLocaleString(i18n.language);
  const reason = (code: string) => PAGE_TAKEDOWN_REASON_LABELS[code as PageTakedownReason]?.[language] ?? code;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t("pages.reports.hint")}</p>
      {done && (
        <p role="status" className="text-sm text-green-700 dark:text-green-400">
          {done}
        </p>
      )}
      {groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("pages.reports.empty")}</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-left text-sm" aria-label={t("pages.tabs.reports")}>
            <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="py-2 pl-3 pr-4 font-medium">{t("pages.reports.columns.page")}</th>
                <th className="py-2 pr-4 font-medium">{t("pages.reports.columns.gym")}</th>
                <th className="py-2 pr-4 font-medium">{t("pages.reports.columns.count")}</th>
                <th className="py-2 pr-4 font-medium">{t("pages.reports.columns.first")}</th>
                <th className="py-2 pr-4 font-medium">{t("pages.reports.columns.due")}</th>
                <th className="py-2 pr-4 font-medium">{t("pages.reports.columns.status")}</th>
                <th className="py-2 pr-3 font-medium">{t("pages.reports.columns.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <ReportRows
                  key={g.gymId}
                  g={g}
                  expanded={open[g.gymId] === true}
                  fmt={fmt}
                  reason={reason}
                  onToggle={() => setOpen((o) => ({ ...o, [g.gymId]: !o[g.gymId] }))}
                  onDismiss={() => setDismissing(g)}
                  onTakeDown={() => setTakingDown(g)}
                  onClose={() => setClosing(g)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {dismissing && (
        <SupportActionModal
          title={t("pages.reports.dismissTitle", { name: dismissing.pageName })}
          description={t("pages.reports.dismissDescription")}
          submitLabel={t("pages.reports.dismissSubmit")}
          reasonLabel={t("pages.reports.dismissNote")}
          run={(note) => dismissPageReports({ reportIds: dismissing.rows.map((r) => r.id), note })}
          onDone={() => {
            setDone(t("pages.reports.dismissed", { name: dismissing.pageName }));
            setDismissing(null);
            router.refresh();
          }}
          onClose={() => setDismissing(null)}
        />
      )}
      {takingDown && (
        <TakedownDialog
          gymId={takingDown.gymId}
          pageName={takingDown.pageName}
          reportIds={takingDown.rows.map((r) => r.id)}
          onDone={() => {
            setDone(t("pages.takedown.done", { name: takingDown.pageName }));
            setTakingDown(null);
            router.refresh();
          }}
          onClose={() => setTakingDown(null)}
        />
      )}
      {closing && (
        <ConfirmCloseTakenDown
          g={closing}
          onDone={() => {
            setDone(t("pages.reports.closedTakenDown", { name: closing.pageName }));
            setClosing(null);
            router.refresh();
          }}
          onClose={() => setClosing(null)}
        />
      )}
    </div>
  );
}

function ReportRows({
  g,
  expanded,
  fmt,
  reason,
  onToggle,
  onDismiss,
  onTakeDown,
  onClose,
}: {
  g: Group;
  expanded: boolean;
  fmt: (iso: string) => string;
  reason: (code: string) => string;
  onToggle: () => void;
  onDismiss: () => void;
  onTakeDown: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const actions: RowAction[] = [
    expanded
      ? { key: "toggle", label: t("pages.reports.hide"), icon: <EyeOff size={14} />, onSelect: onToggle }
      : { key: "toggle", label: t("pages.reports.show"), icon: <Eye size={14} />, onSelect: onToggle },
  ];
  if (g.pageTakenDown) {
    actions.push({ key: "close", label: t("pages.reports.closeTakenDown"), icon: <CheckCircle size={14} />, onSelect: onClose });
  } else {
    actions.push({ key: "dismiss", label: t("pages.reports.dismiss"), icon: <XCircle size={14} />, onSelect: onDismiss });
    actions.push({ key: "takedown", label: t("pages.reports.takeDown"), icon: <Ban size={14} />, destructive: true, onSelect: onTakeDown });
  }
  return (
    <>
      <tr className="border-b last:border-b-0 align-top">
        <td className="py-2 pl-3 pr-4 font-medium">{g.pageName}</td>
        <td className="py-2 pr-4">{g.gymName}</td>
        <td className="py-2 pr-4">{g.rows.length}</td>
        <td className="py-2 pr-4">{fmt(g.firstReportedAt)}</td>
        <td className="py-2 pr-4">
          {fmt(g.dueAt)}
          {g.overdue && (
            <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-800 dark:bg-red-950 dark:text-red-200">
              {t("pages.reports.overdue")}
            </span>
          )}
        </td>
        <td className="py-2 pr-4">{g.pageTakenDown ? t("pages.reports.status.takenDown") : t("pages.reports.status.open")}</td>
        <td className="py-2 pr-3">
          <RowActions name={g.pageName} actions={actions} />
        </td>
      </tr>
      {expanded && (
        <tr className="border-b bg-muted/20">
          <td colSpan={7} className="px-3 py-2">
            <ul className="space-y-2" aria-label={t("pages.reports.details")}>
              {g.rows.map((r) => (
                <li key={r.id} className="text-sm">
                  <p className="font-medium">
                    {reason(r.reason)} <span className="font-normal text-muted-foreground">· {fmt(r.createdAt)}</span>
                  </p>
                  {/* the visitor's own text, rendered as text only (React escapes it) and with its line breaks */}
                  <p className="whitespace-pre-wrap break-words">{r.details}</p>
                </li>
              ))}
            </ul>
          </td>
        </tr>
      )}
    </>
  );
}

/** A page that is already taken down: its open reports are closed as taken down, linked to that takedown (no reason is asked). */
function ConfirmCloseTakenDown({ g, onDone, onClose }: { g: Group; onDone: () => void; onClose: () => void }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run() {
    setBusy(true);
    setError(null);
    try {
      const res = await closePageReportsTakenDown({ reportIds: g.rows.map((r) => r.id) });
      if (res.error) {
        setError(res.error.message);
        return;
      }
      onDone();
    } catch {
      setError(t("pages.errors.generic"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div role="alertdialog" aria-label={t("pages.reports.closeTakenDown")} className="rounded-md border bg-card p-4 text-sm shadow-sm">
      <p className="mb-2">{t("pages.reports.closeConfirm", { name: g.pageName })}</p>
      {error && (
        <p role="alert" className="mb-2 text-destructive">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button size="sm" disabled={busy} onClick={() => void run()}>
          {busy ? t("pages.takedown.working") : t("pages.reports.closeTakenDown")}
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={onClose}>
          {t("pages.takedown.cancel")}
        </Button>
      </div>
    </div>
  );
}
