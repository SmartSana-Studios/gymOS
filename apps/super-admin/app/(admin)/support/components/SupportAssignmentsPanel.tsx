"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import {
  assignSupport,
  confirmSupportAssignment,
  unassignSupport,
  type SupportAccountRow,
  type SupportAssignmentRow,
} from "../actions";

export const REASON_MIN = 3;
export const REASON_MAX = 500;

/**
 * Story 23.5: assignments of GymOS support people to gyms. The individual's name and address are shown here and on nowhere an
 * Owner can reach. Every action needs a reason (3-500 characters), shared with the page through `reason`.
 */
export function SupportAssignmentsPanel({
  assignments,
  accounts,
  gyms,
  fixedGymId,
  reason,
  onMessage,
}: {
  assignments: SupportAssignmentRow[];
  accounts: SupportAccountRow[];
  /** The gyms an assignment can be made in. Omitted on the gym detail page, where `fixedGymId` is the only gym. */
  gyms?: { id: string; name: string }[];
  fixedGymId?: string;
  reason: string;
  onMessage: (m: { kind: "ok" | "error"; text: string }) => void;
}) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const [userId, setUserId] = useState("");
  const [gymId, setGymId] = useState(fixedGymId ?? "");
  const [pending, startTransition] = useTransition();

  const reasonOk = reason.trim().length >= REASON_MIN && reason.trim().length <= REASON_MAX;
  const assignable = accounts.filter((a) => a.assignable && a.inviteState !== "deactivated");
  const open = assignments.filter((a) => a.state !== "ended");
  const ended = assignments.filter((a) => a.state === "ended");

  function run(action: () => Promise<{ data: { code: string } | null; error: { message: string } | null }>) {
    startTransition(async () => {
      const { data, error } = await action();
      onMessage(error ? { kind: "error", text: error.message } : { kind: "ok", text: t(`support.assign.done.${data?.code ?? "ok"}`, { defaultValue: t("support.assign.done.ok") }) });
      router.refresh();
    });
  }

  function assign(e: React.FormEvent) {
    e.preventDefault();
    run(() => assignSupport({ userId, gymId: fixedGymId ?? gymId, reason }));
  }

  const stateLabel = (a: SupportAssignmentRow) =>
    a.state === "suspended" && a.suspendedBySwitch ? t("support.assign.state.suspendedBySwitch") : t(`support.assign.state.${a.state}`);

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">{t("support.assign.title")}</h2>

      <form onSubmit={assign} className="grid gap-3 rounded-md border p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <label className="space-y-1 text-sm">
          <span className="font-medium">{t("support.assign.person")}</span>
          <select className="h-9 w-full rounded-md border bg-background px-2" value={userId} onChange={(e) => setUserId(e.target.value)} required>
            <option value="">{t("support.assign.choose")}</option>
            {assignable.map((a) => (
              <option key={a.userId} value={a.userId}>
                {(a.displayName ?? a.email) + (a.activated ? "" : ` (${t("support.state.inactive")})`)}
              </option>
            ))}
          </select>
        </label>
        {fixedGymId ? (
          <span />
        ) : (
          <label className="space-y-1 text-sm">
            <span className="font-medium">{t("support.assign.gym")}</span>
            <select className="h-9 w-full rounded-md border bg-background px-2" value={gymId} onChange={(e) => setGymId(e.target.value)} required>
              <option value="">{t("support.assign.choose")}</option>
              {(gyms ?? []).map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <Button type="submit" disabled={pending || !reasonOk || !userId || !(fixedGymId ?? gymId)}>
          {t("support.assign.submit")}
        </Button>
        <p className="text-xs text-muted-foreground sm:col-span-3">{t("support.assign.hint")}</p>
      </form>

      {open.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("support.assign.empty")}</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 pl-3 pr-4 font-medium">{t("support.columns.name")}</th>
                {!fixedGymId && <th className="py-2 pr-4 font-medium">{t("support.assign.gym")}</th>}
                <th className="py-2 pr-4 font-medium">{t("support.columns.state")}</th>
                <th className="py-2 pr-4 font-medium">{t("support.assign.since")}</th>
                <th className="py-2 pr-3 font-medium">{t("support.columns.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {open.map((a) => (
                <tr key={a.assignmentId} className="border-b last:border-b-0">
                  <td className="py-2 pl-3 pr-4">{a.displayName ?? a.email ?? "—"}</td>
                  {!fixedGymId && <td className="py-2 pr-4">{a.gymName}</td>}
                  <td className="py-2 pr-4">{stateLabel(a)}</td>
                  <td className="py-2 pr-4">{new Date(a.createdAt).toLocaleDateString(i18n.language)}</td>
                  <td className="space-x-2 py-2 pr-3">
                    {a.state === "pending" && (
                      <Button size="sm" disabled={pending || !reasonOk} onClick={() => run(() => confirmSupportAssignment({ assignmentId: a.assignmentId, reason }))}>
                        {t("support.assign.confirm")}
                      </Button>
                    )}
                    <Button size="sm" variant="outline" disabled={pending || !reasonOk} onClick={() => run(() => unassignSupport({ assignmentId: a.assignmentId, reason }))}>
                      {t("support.assign.unassign")}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

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
    </section>
  );
}
