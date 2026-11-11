"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import { ArrowRight, Globe } from "lucide-react";
import type { PageStatusState } from "@gymos/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { LANDING_PAGE_PATH } from "@/lib/landingPage";
import { SectionHeader } from "./SectionHeader";
import { CustomWebsiteNotice } from "./landing-page/components/CustomWebsiteNotice";
import { StatusBadge } from "./landing-page/components/StatusBadge";

/** Who sees the Settings row: Owner, Supervisor and an assigned support person. Everyone else gets nothing in the DOM. */
export function canSeeLandingPageRow(role: string | null | undefined): boolean {
  return role === "owner" || role === "supervisor" || role === "support";
}

export function promptStorageKey(userKey: string): string {
  return `gymos.landingPagePrompt.dismissed.${userKey}`;
}

function readDismissed(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function writeDismissed(key: string) {
  try {
    window.localStorage.setItem(key, "1");
  } catch {
    /* private window or blocked storage: the prompt simply shows again */
  }
}

/**
 * The "Landing page" row of Settings: status badge (icon plus words) and [Open]. For an existing gym that has not started a page,
 * the first visit also shows [Set up my page] / [Not now]. Dismissal is remembered per user in the browser. Nothing is published
 * either way.
 */
export function LandingPageSection({ state, userKey }: { state: PageStatusState | null; userKey: string }) {
  const { t } = useTranslation();
  const storageKey = promptStorageKey(userKey);
  // Hidden until we have read storage, so a user who dismissed it never sees it flash.
  const [promptVisible, setPromptVisible] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- browser storage is only readable after mount
    setPromptVisible(state === "not_started" && !readDismissed(storageKey));
  }, [state, storageKey]);

  function dismiss() {
    writeDismissed(storageKey);
    setPromptVisible(false);
  }

  return (
    <Card data-testid="landing-page-row">
      <SectionHeader icon={Globe} accent="emerald" title={t("settings.sections.landingPage")} description={t("settings.sectionDescriptions.landingPage")} />
      <CardContent className="space-y-3">
        {promptVisible && (
          <div role="region" aria-label={t("pageEditor.firstVisit.title")} data-testid="landing-page-prompt" className="space-y-3 rounded-md border bg-muted/40 p-4">
            <p className="text-sm">{t("pageEditor.firstVisit.body")}</p>
            <div className="flex flex-wrap gap-2">
              <Button asChild size="sm">
                <Link href={LANDING_PAGE_PATH} onClick={dismiss}>
                  {t("pageEditor.firstVisit.setUp")}
                </Link>
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={dismiss}>
                {t("pageEditor.firstVisit.notNow")}
              </Button>
            </div>
          </div>
        )}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          {state ? <StatusBadge state={state} /> : <span className="text-sm text-muted-foreground">{t("pageEditor.statusUnknown")}</span>}
          <Button asChild variant="outline" size="sm">
            <Link href={LANDING_PAGE_PATH}>
              {t("pageEditor.settingsRow.open")}
              <ArrowRight />
            </Link>
          </Button>
        </div>
        <div className="border-t pt-3">
          <CustomWebsiteNotice variant="inline" />
        </div>
      </CardContent>
    </Card>
  );
}
