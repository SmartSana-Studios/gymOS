"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { Building2, ExternalLink, Ban, Undo2 } from "lucide-react";

import { Input } from "@/components/ui/input";

import { RowActions, type RowAction } from "../../support/components/RowActions";
import { SupportActionModal } from "../../support/components/SupportActionModal";
import { liftPageTakedown, type ActivePageRow } from "../actions";
import { pagePublicHost } from "../tabs";
import { TakedownDialog } from "./TakedownDialog";

const STATUS_CLASS: Record<ActivePageRow["status"], string> = {
  live: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200",
  taken_down: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
  paused: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
};

/** The text a search matches: page name, gym name and the public address. */
export function activePageMatches(row: ActivePageRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const host = row.pageName ? pagePublicHost(row.pageName) : "";
  return [row.pageName ?? "", row.gymName, host].some((v) => v.toLowerCase().includes(q));
}

/**
 * The Active tab: every published page with its `name.gymosapps.com` address, template, publish date and status (Live, Taken down, Paused).
 * Search narrows the list. One Actions menu per row: Open page (only while Live), View gym, Take down (Live), Lift takedown (Taken down).
 */
export function ActivePagesPanel({ rows: loaded }: { rows: ActivePageRow[] | null }) {
  const rows = useMemo(() => loaded ?? [], [loaded]);
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [takingDown, setTakingDown] = useState<ActivePageRow | null>(null);
  const [lifting, setLifting] = useState<ActivePageRow | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const shown = useMemo(() => rows.filter((r) => activePageMatches(r, query)), [rows, query]);
  const fmt = (iso: string) => new Date(iso).toLocaleDateString(i18n.language);
  const label = (r: ActivePageRow) => r.pageName ?? r.gymName;

  function actionsFor(r: ActivePageRow): RowAction[] {
    const actions: RowAction[] = [];
    if (r.status === "live" && r.pageName) {
      const url = `https://${pagePublicHost(r.pageName)}`;
      actions.push({ key: "open", label: t("pages.active.actions.open"), icon: <ExternalLink size={14} />, onSelect: () => window.open(url, "_blank", "noopener,noreferrer") });
    }
    actions.push({ key: "gym", label: t("pages.active.actions.viewGym"), icon: <Building2 size={14} />, onSelect: () => router.push(`/gyms/${r.gymId}`) });
    if (r.status === "live") {
      actions.push({ key: "takedown", label: t("pages.active.actions.takeDown"), icon: <Ban size={14} />, destructive: true, onSelect: () => setTakingDown(r) });
    }
    if (r.status === "taken_down") {
      actions.push({ key: "lift", label: t("pages.active.actions.lift"), icon: <Undo2 size={14} />, onSelect: () => setLifting(r) });
    }
    return actions;
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t("pages.active.hint")}</p>
      {done && (
        <p role="status" className="text-sm text-green-700 dark:text-green-400">
          {done}
        </p>
      )}
      {loaded === null ? (
        <p role="alert" className="text-sm text-destructive">
          {t("pages.active.loadFailed")}
        </p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("pages.active.empty")}</p>
      ) : (
        <>
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("pages.active.search")}
            aria-label={t("pages.active.search")}
            className="max-w-sm"
          />
          {shown.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("pages.active.noMatch")}</p>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-left text-sm" aria-label={t("pages.tabs.active")}>
                <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    <th className="py-2 pl-3 pr-4 font-medium">{t("pages.active.columns.domain")}</th>
                    <th className="py-2 pr-4 font-medium">{t("pages.active.columns.gym")}</th>
                    <th className="py-2 pr-4 font-medium">{t("pages.active.columns.template")}</th>
                    <th className="py-2 pr-4 font-medium">{t("pages.active.columns.published")}</th>
                    <th className="py-2 pr-4 font-medium">{t("pages.active.columns.status")}</th>
                    <th className="py-2 pr-3 font-medium">{t("pages.active.columns.actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r) => (
                    <tr key={r.gymId} className="border-b last:border-b-0">
                      <td className="py-2 pl-3 pr-4 font-medium">{r.pageName ? pagePublicHost(r.pageName) : t("pages.active.noName")}</td>
                      <td className="py-2 pr-4">{r.gymName}</td>
                      <td className="py-2 pr-4">{t(`pages.active.templates.${r.template}`, { defaultValue: r.template })}</td>
                      <td className="py-2 pr-4">{fmt(r.publishedAt)}</td>
                      <td className="py-2 pr-4">
                        <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${STATUS_CLASS[r.status]}`}>{t(`pages.active.status.${r.status}`)}</span>
                      </td>
                      <td className="py-2 pr-3">
                        <RowActions name={label(r)} actions={actionsFor(r)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {takingDown && (
        <TakedownDialog
          gymId={takingDown.gymId}
          pageName={label(takingDown)}
          onDone={() => {
            setDone(t("pages.takedown.done", { name: label(takingDown) }));
            setTakingDown(null);
            router.refresh();
          }}
          onClose={() => setTakingDown(null)}
        />
      )}
      {lifting && (
        <SupportActionModal
          title={t("pages.takedown.liftTitle", { name: label(lifting) })}
          description={t("pages.takedown.liftDescription")}
          submitLabel={t("pages.takedown.liftSubmit")}
          reasonLabel={t("pages.takedown.liftReason")}
          run={(text) => liftPageTakedown({ gymId: lifting.gymId, reason: text })}
          stepUp={{ action: "lift_gym_page_takedown", subjectId: lifting.gymId }}
          onDone={() => {
            setDone(t("pages.takedown.lifted", { name: label(lifting) }));
            setLifting(null);
            router.refresh();
          }}
          onClose={() => setLifting(null)}
        />
      )}
    </div>
  );
}
