"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { answerDisclosureRequest, type DisclosureInboxRow } from "../actions";

const ANSWER_MIN = 3;
const ANSWER_MAX = 2000;

/**
 * Story 23.8: Owner questions about a specific audit row. The answer is stored with the request and delivered to the Owner outside
 * the product; the Owner also reads it in the dashboard. Overdue requests are marked.
 */
export function DisclosureInbox({ requests }: { requests: DisclosureInboxRow[] }) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const when = (iso: string) => new Date(iso).toLocaleString(i18n.language);

  function answer(id: string) {
    startTransition(async () => {
      const { error } = await answerDisclosureRequest({ requestId: id, answer: answers[id] ?? "" });
      setMessage(error ? { kind: "error", text: error.message } : { kind: "ok", text: t("support.disclosure.answered") });
      if (!error) router.refresh();
    });
  }

  return (
    <section className="space-y-3 rounded-md border p-6" aria-label={t("support.disclosure.title")}>
      <h2 className="text-sm font-semibold text-muted-foreground">{t("support.disclosure.title")}</h2>
      {message && (
        <p role="status" className={message.kind === "ok" ? "text-sm" : "text-sm text-red-600"}>
          {message.text}
        </p>
      )}
      {requests.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("support.disclosure.empty")}</p>
      ) : (
        <ul className="space-y-4 text-sm">
          {requests.map((r) => {
            const text = (answers[r.id] ?? "").trim();
            return (
              <li key={r.id} className="space-y-1 border-b pb-3 last:border-b-0">
                <p className="font-medium">{r.gymName}</p>
                <p className="text-xs text-muted-foreground">
                  {t("support.disclosure.row", { action: r.auditActionType, date: when(r.auditCreatedAt) })}
                </p>
                <p>{r.question}</p>
                {r.answeredAt ? (
                  <p>
                    <span className="font-medium">{t("support.disclosure.answerLabel")}: </span>
                    {r.answer}
                  </p>
                ) : (
                  <>
                    <p className={r.overdue ? "text-xs font-medium text-red-600" : "text-xs text-muted-foreground"}>
                      {r.overdue ? t("support.disclosure.overdue") : t("support.disclosure.due")} · {when(r.answerDueAt)}
                    </p>
                    <textarea
                      aria-label={t("support.disclosure.answerLabel")}
                      value={answers[r.id] ?? ""}
                      maxLength={ANSWER_MAX}
                      onChange={(e) => setAnswers((prev) => ({ ...prev, [r.id]: e.target.value }))}
                      className="flex min-h-20 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm"
                    />
                    <Button size="sm" disabled={pending || text.length < ANSWER_MIN} onClick={() => answer(r.id)}>
                      {t("support.disclosure.submit")}
                    </Button>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
