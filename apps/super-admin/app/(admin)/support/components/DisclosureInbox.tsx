"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MessageSquare } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { answerDisclosureRequest, type DisclosureInboxRow } from "../actions";
import type { SupportMessage } from "./constants";
import { PagedTable } from "./PagedTable";
import { RowActions } from "./RowActions";

const ANSWER_MIN = 3;
const ANSWER_MAX = 2000;

/**
 * Story 23.8 / 23.12: Owner questions about a specific audit row. The answer is collected in a modal, stored with the request and
 * delivered to the Owner outside the product; the Owner also reads it in the dashboard. Overdue requests are marked.
 */
export function DisclosureInbox({ requests, onMessage }: { requests: DisclosureInboxRow[]; onMessage: (m: SupportMessage) => void }) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const [target, setTarget] = useState<DisclosureInboxRow | null>(null);
  const when = (iso: string) => new Date(iso).toLocaleString(i18n.language);

  return (
    <>
      <PagedTable
        items={requests}
        empty={t("support.disclosure.empty")}
        label={t("support.disclosure.title")}
        head={[
          t("support.disclosure.columns.gym"),
          t("support.disclosure.columns.about"),
          t("support.disclosure.columns.question"),
          t("support.disclosure.columns.status"),
          t("support.columns.actions"),
        ]}
        row={(r) => (
          <tr key={r.id} className="border-b align-top last:border-b-0">
            <td className="py-2 pl-3 pr-4 font-medium">{r.gymName}</td>
            <td className="py-2 pr-4 text-xs text-muted-foreground">{t("support.disclosure.row", { action: r.auditActionType, date: when(r.auditCreatedAt) })}</td>
            <td className="py-2 pr-4">{r.question}</td>
            <td className="py-2 pr-4">
              {r.answeredAt ? (
                <span>
                  <span className="font-medium">{t("support.disclosure.answerLabel")}: </span>
                  {r.answer}
                </span>
              ) : (
                <span className={r.overdue ? "text-xs font-medium text-red-600" : "text-xs text-muted-foreground"}>
                  {r.overdue ? t("support.disclosure.overdue") : t("support.disclosure.due")} · {when(r.answerDueAt)}
                </span>
              )}
            </td>
            <td className="py-2 pr-3">
              <RowActions
                name={r.gymName}
                actions={r.answeredAt ? [] : [{ key: "answer", label: t("support.disclosure.answer"), icon: <MessageSquare size={14} />, onSelect: () => setTarget(r) }]}
              />
            </td>
          </tr>
        )}
      />
      {target && (
        <AnswerModal
          key={target.id}
          request={target}
          onClose={() => setTarget(null)}
          onDone={() => {
            onMessage({ kind: "ok", text: t("support.disclosure.answered") });
            setTarget(null);
            router.refresh();
          }}
        />
      )}
    </>
  );
}

function AnswerModal({ request, onClose, onDone }: { request: DisclosureInboxRow; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trimmed = answer.trim();
  const valid = trimmed.length >= ANSWER_MIN && trimmed.length <= ANSWER_MAX;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { error: err } = await answerDisclosureRequest({ requestId: request.id, answer });
      if (err) {
        setError(err.message);
        return;
      }
      onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent closeLabel={t("support.modal.cancel")}>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{t("support.modal.title.answer")}</DialogTitle>
            <DialogDescription>{request.question}</DialogDescription>
          </DialogHeader>
          <label className="block space-y-1 text-sm">
            <span className="font-medium">{t("support.disclosure.answerField")}</span>
            <textarea
              value={answer}
              maxLength={ANSWER_MAX}
              onChange={(e) => setAnswer(e.target.value)}
              className="flex min-h-24 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm"
            />
          </label>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
              {t("support.modal.cancel")}
            </Button>
            <Button type="submit" disabled={!valid || busy}>
              {t("support.disclosure.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
