"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { PAGE_TAKEDOWN_REASON_LABELS, type PageTakedownReason } from "@gymos/types";

import { Gavel, Undo2 } from "lucide-react";

import { RowActions } from "../../support/components/RowActions";
import { SupportActionModal } from "../../support/components/SupportActionModal";
import { decidePageAppeal, type PageAppealRow } from "../actions";

const TRUNCATE = 120;

/** SA-18: every appeal, the undecided first. Deciding needs a reason that is sent to the Owner; lifting also needs a fresh authenticator code. */
export function AppealsPanel({ rows }: { rows: PageAppealRow[] }) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const language = i18n.language === "fr" ? "fr" : "en";
  const [deciding, setDeciding] = useState<{ row: PageAppealRow; decision: "lift" | "uphold" } | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const fmt = (iso: string) => new Date(iso).toLocaleDateString(i18n.language);
  const reason = (code: string) => PAGE_TAKEDOWN_REASON_LABELS[code as PageTakedownReason]?.[language] ?? code;
  const status = (r: PageAppealRow) => t(`pages.appeals.status.${r.decision ?? "open"}`);

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t("pages.appeals.hint")}</p>
      {done && (
        <p role="status" className="text-sm text-green-700 dark:text-green-400">
          {done}
        </p>
      )}
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("pages.appeals.empty")}</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-left text-sm" aria-label={t("pages.tabs.appeals")}>
            <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="py-2 pl-3 pr-4 font-medium">{t("pages.appeals.columns.page")}</th>
                <th className="py-2 pr-4 font-medium">{t("pages.appeals.columns.gym")}</th>
                <th className="py-2 pr-4 font-medium">{t("pages.appeals.columns.reason")}</th>
                <th className="py-2 pr-4 font-medium">{t("pages.appeals.columns.takenDown")}</th>
                <th className="py-2 pr-4 font-medium">{t("pages.appeals.columns.appeal")}</th>
                <th className="py-2 pr-4 font-medium">{t("pages.appeals.columns.appealedOn")}</th>
                <th className="py-2 pr-4 font-medium">{t("pages.appeals.columns.status")}</th>
                <th className="py-2 pr-3 font-medium">{t("pages.appeals.columns.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b align-top last:border-b-0">
                  <td className="py-2 pl-3 pr-4 font-medium">{r.pageName ?? t("pages.appeals.noPage")}</td>
                  <td className="py-2 pr-4">{r.gymName}</td>
                  <td className="py-2 pr-4">
                    {reason(r.takedownReason)}
                    {r.takedownNote && <p className="text-xs text-muted-foreground">{t("pages.appeals.internalNote", { note: r.takedownNote })}</p>}
                  </td>
                  <td className="py-2 pr-4">{fmt(r.takenDownAt)}</td>
                  <td className="max-w-xs py-2 pr-4">
                    <span className="whitespace-pre-wrap break-words" title={r.appealReason}>
                      {r.appealReason.length > TRUNCATE ? `${r.appealReason.slice(0, TRUNCATE)}…` : r.appealReason}
                    </span>
                  </td>
                  <td className="py-2 pr-4">{fmt(r.appealedAt)}</td>
                  <td className="py-2 pr-4">
                    {status(r)}
                    {r.decisionReason && <p className="text-xs text-muted-foreground">{r.decisionReason}</p>}
                  </td>
                  <td className="py-2 pr-3">
                    <RowActions
                      name={r.pageName ?? r.gymName}
                      actions={
                        r.decision === null
                          ? [
                              { key: "lift", label: t("pages.appeals.lift"), icon: <Undo2 size={14} />, onSelect: () => setDeciding({ row: r, decision: "lift" }) },
                              { key: "uphold", label: t("pages.appeals.uphold"), icon: <Gavel size={14} />, onSelect: () => setDeciding({ row: r, decision: "uphold" }) },
                            ]
                          : []
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {deciding && (
        <SupportActionModal
          title={t(deciding.decision === "lift" ? "pages.appeals.liftTitle" : "pages.appeals.upholdTitle", { name: deciding.row.pageName ?? deciding.row.gymName })}
          description={t(deciding.decision === "lift" ? "pages.appeals.liftDescription" : "pages.appeals.upholdDescription")}
          submitLabel={t(deciding.decision === "lift" ? "pages.appeals.lift" : "pages.appeals.uphold")}
          reasonLabel={t("pages.appeals.reason")}
          run={(text) => decidePageAppeal({ id: deciding.row.id, gymId: deciding.row.gymId, decision: deciding.decision, reason: text })}
          stepUp={deciding.decision === "lift" ? { action: "lift_gym_page_takedown", subjectId: deciding.row.gymId } : undefined}
          onDone={() => {
            setDone(t("pages.appeals.decided", { name: deciding.row.pageName ?? deciding.row.gymName }));
            setDeciding(null);
            router.refresh();
          }}
          onClose={() => setDeciding(null)}
        />
      )}
    </div>
  );
}
