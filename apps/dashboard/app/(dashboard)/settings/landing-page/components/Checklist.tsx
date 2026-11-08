"use client";

import { useTranslation } from "react-i18next";
import { CheckCircle2, XCircle } from "lucide-react";
import type { GymPageName, GymPageStatus, PageContentLanguage } from "@gymos/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CHECKLIST_ITEMS, buildChecklist, gateCodeAnchor, sectionAnchor, sortGateCodes } from "@/lib/landingPage";
import { itemLine, languageName } from "./pageCopy";

/** Nine required items, rendered from the server's missing codes. Each missing item links to its field. aria-live: it changes after a save. */
export function Checklist({
  status,
  pageName,
  onOpenTextTab,
}: {
  status: GymPageStatus;
  pageName: GymPageName;
  onOpenTextTab: () => void;
}) {
  const { t } = useTranslation();
  const { rows, readyCount, total } = buildChecklist(status);
  const sectionOf = Object.fromEntries(CHECKLIST_ITEMS.map((i) => [i.id, i.section]));
  // codes that are about the content rather than a missing item: map position, forbidden characters, size
  const itemCodes = new Set<string>(CHECKLIST_ITEMS.flatMap((i) => [...i.codes]));
  const extras = sortGateCodes(status.missing.filter((c) => !itemCodes.has(c)));

  return (
    <Card data-testid="page-checklist">
      <CardHeader>
        <CardTitle role="heading" aria-level={2} className="text-base">
          {t("pageEditor.checklist.title", { ready: readyCount, total })}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <ul className="space-y-2" aria-live="polite">
          {rows.map((row) => {
            const label = t(`pageEditor.checklist.items.${row.id}`);
            const underReview = row.id === "name" && pageName.state === "held";
            return (
              <li key={row.id} className="flex items-start gap-2 text-sm" data-testid={`checklist-${row.id}`} data-ready={row.ready}>
                {row.ready ? (
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden="true" />
                ) : (
                  <XCircle className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                )}
                <span className="flex-1">
                  <span className="sr-only">{row.ready ? t("pageEditor.checklist.ready") : t("pageEditor.checklist.notReady")}: </span>
                  {label}
                  {underReview && <span className="ml-2 text-muted-foreground">{t("pageEditor.checklist.nameUnderReview")}</span>}
                  {!row.ready && row.id !== "name" && row.missing.length > 0 && (
                    <span className="ml-2 text-muted-foreground">{row.missing.map((c) => itemLine(t, c, status)).join(" ")}</span>
                  )}
                </span>
                {!row.ready &&
                  (row.id === "about" ? (
                    <button type="button" className="text-sm underline" onClick={onOpenTextTab}>
                      {t("pageEditor.checklist.goTo")}
                    </button>
                  ) : (
                    <a href={sectionAnchor(sectionOf[row.id] as Parameters<typeof sectionAnchor>[0])} className="text-sm underline">
                      {t("pageEditor.checklist.goTo")}
                    </a>
                  ))}
              </li>
            );
          })}
        </ul>
        {extras.length > 0 && (
          <ul className="space-y-1 text-sm" data-testid="checklist-extras" aria-live="polite">
            {extras.map((c) => (
              <li key={c} className="flex items-start gap-2">
                <XCircle className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="flex-1">{itemLine(t, c, status)}</span>
                <a href={gateCodeAnchor(c)} className="underline">
                  {t("pageEditor.checklist.goTo")}
                </a>
              </li>
            ))}
          </ul>
        )}
        <p className="text-sm text-muted-foreground">{t("pageEditor.checklist.optional")}</p>
        <p className="text-sm text-muted-foreground">{t("pageEditor.checklist.summary", { total })}</p>
      </CardContent>
    </Card>
  );
}

/** "Languages offered": the complete languages, and for an incomplete one that has any content what it lacks. Information, not an item. */
export function LanguagesOffered({
  status,
  hasContent,
  onOpenTextTab,
}: {
  status: GymPageStatus;
  /** Languages that hold any text in About or Services (from the form or the stored page). */
  hasContent: ReadonlySet<PageContentLanguage>;
  onOpenTextTab: () => void;
}) {
  const { t } = useTranslation();
  const complete = status.languages.filter((l) => l.complete);
  const lacking = status.languages.filter((l) => !l.complete && hasContent.has(l.code));
  return (
    <p className="text-sm" data-testid="languages-offered">
      <span className="font-medium">{t("pageEditor.languagesOffered.label")}</span>{" "}
      {complete.length > 0 ? complete.map((l) => languageName(t, l.code)).join(", ") : t("pageEditor.languagesOffered.none")}
      {lacking.map((l) => (
        <span key={l.code} className="ml-2 text-muted-foreground">
          {t("pageEditor.languagesOffered.needs", { language: languageName(t, l.code), count: l.needed })}
        </span>
      ))}
      {lacking.length > 0 && (
        <button type="button" className="ml-2 underline" onClick={onOpenTextTab}>
          {t("pageEditor.checklist.goTo")}
        </button>
      )}
    </p>
  );
}
