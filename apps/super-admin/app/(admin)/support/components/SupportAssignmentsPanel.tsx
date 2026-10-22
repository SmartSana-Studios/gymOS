"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, UserMinus } from "lucide-react";
import { useTranslation } from "react-i18next";

import { confirmSupportAssignment, unassignSupport, type SupportAssignmentRow } from "../actions";
import type { SupportMessage } from "./constants";
import { PagedTable } from "./PagedTable";
import { RowActions } from "./RowActions";
import { SupportActionModal } from "./SupportActionModal";

type Target = { kind: "confirm" | "unassign"; row: SupportAssignmentRow } | null;

/**
 * Story 23.5 / 23.12: assignments of GymOS support people to gyms. The individual's name and address are shown here and on nowhere an
 * Owner can reach. Confirm and Unassign each open a modal that collects the reason (3-500 characters).
 */
export function SupportAssignmentsPanel({
  assignments,
  fixedGymId,
  onMessage,
}: {
  assignments: SupportAssignmentRow[];
  /** Set on the gym detail page: the gym column is dropped. */
  fixedGymId?: string;
  onMessage: (m: SupportMessage) => void;
}) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const [target, setTarget] = useState<Target>(null);
  const open = assignments.filter((a) => a.state !== "ended");
  const ended = assignments.filter((a) => a.state === "ended");

  const stateLabel = (a: SupportAssignmentRow) =>
    a.state === "suspended" && a.suspendedBySwitch ? t("support.assign.state.suspendedBySwitch") : t(`support.assign.state.${a.state}`);

  return (
    <div className="space-y-3">
      <PagedTable
        items={open}
        empty={t("support.assign.empty")}
        label={t("support.assign.title")}
        head={[
          t("support.columns.name"),
          ...(fixedGymId ? [] : [t("support.assign.gym")]),
          t("support.columns.state"),
          t("support.assign.since"),
          t("support.columns.actions"),
        ]}
        row={(a) => (
          <tr key={a.assignmentId} className="border-b last:border-b-0">
            <td className="py-2 pl-3 pr-4">{a.displayName ?? a.email ?? "—"}</td>
            {!fixedGymId && <td className="py-2 pr-4">{a.gymName}</td>}
            <td className="py-2 pr-4">{stateLabel(a)}</td>
            <td className="py-2 pr-4">{new Date(a.createdAt).toLocaleDateString(i18n.language)}</td>
            <td className="py-2 pr-3">
              <RowActions
                name={a.displayName ?? a.email ?? "—"}
                actions={[
                  ...(a.state === "pending"
                    ? [{ key: "confirm", label: t("support.assign.confirm"), icon: <CheckCircle2 size={14} />, onSelect: () => setTarget({ kind: "confirm", row: a }) }]
                    : []),
                  { key: "unassign", label: t("support.assign.unassign"), icon: <UserMinus size={14} />, destructive: true, onSelect: () => setTarget({ kind: "unassign", row: a }) },
                ]}
              />
            </td>
          </tr>
        )}
      />

      {ended.length > 0 && (
        <details className="text-sm text-muted-foreground">
          <summary className="cursor-pointer">{t("support.assign.endedCount", { count: ended.length })}</summary>
          <ul className="mt-2 space-y-1">
            {ended.map((a) => (
              <li key={a.assignmentId}>
                {(a.displayName ?? a.email ?? "—") + (fixedGymId ? "" : ` · ${a.gymName}`)} · {a.endedAt ? new Date(a.endedAt).toLocaleDateString(i18n.language) : ""}
              </li>
            ))}
          </ul>
        </details>
      )}

      {target && (
        <SupportActionModal
          key={`${target.kind}-${target.row.assignmentId}`}
          title={t(`support.modal.title.${target.kind}`)}
          description={t(target.kind === "confirm" ? "support.modal.confirmConfirm" : "support.modal.confirmUnassign")}
          submitLabel={t(target.kind === "confirm" ? "support.assign.confirm" : "support.assign.unassign")}
          run={(reason) => (target.kind === "confirm" ? confirmSupportAssignment : unassignSupport)({ assignmentId: target.row.assignmentId, reason })}
          onDone={(data) => {
            const code = (data as { code?: string } | null)?.code ?? "ok";
            onMessage({ kind: "ok", text: t(`support.assign.done.${code}`, { defaultValue: t("support.assign.done.ok") }) });
            setTarget(null);
            router.refresh();
          }}
          onClose={() => setTarget(null)}
        />
      )}
    </div>
  );
}
