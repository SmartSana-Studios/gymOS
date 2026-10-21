"use client";

import { useTranslation } from "react-i18next";

import type { DisclosureRequest } from "@/services/auditDisclosure";

/** Story 23.8: the Owner's own questions about audit entries, with the due date and, once given, GymOS's answer. */
export function DisclosureRequestsPanel({ requests }: { requests: DisclosureRequest[] }) {
  const { t, i18n } = useTranslation();
  if (requests.length === 0) return null;
  const when = (iso: string) => new Date(iso).toLocaleDateString(i18n.language);
  return (
    <section aria-label={t("audit.disclosure.title")} className="space-y-2 rounded-md border p-4">
      <h2 className="text-base font-semibold">{t("audit.disclosure.title")}</h2>
      <ul className="space-y-3">
        {requests.map((request) => (
          <li key={request.id} className="space-y-1 text-sm">
            <p className="text-xs text-muted-foreground">{t("audit.disclosure.entry", { id: request.auditLogId.slice(0, 8) })}</p>
            <p>{request.question}</p>
            {request.answeredAt ? (
              <>
                <p className="text-xs text-muted-foreground">{t("audit.disclosure.answered", { date: when(request.answeredAt) })}</p>
                <p>
                  <span className="font-medium">{t("audit.disclosure.answerLabel")}: </span>
                  {request.answer}
                </p>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">
                {t("audit.disclosure.open")} · {t("audit.disclosure.due", { date: when(request.answerDueAt) })}
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
