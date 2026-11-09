"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslation } from "react-i18next";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import type { HeldPageNameRow } from "../../page-names/actions";
import { HeldNamesClient } from "../../page-names/components/HeldNamesClient";
import type { PageAppealRow, PageReportRow } from "../actions";
import { AppealsPanel } from "./AppealsPanel";
import { ReportsPanel } from "./ReportsPanel";

export const PAGES_TABS = ["names", "reports", "appeals"] as const;
export type PagesTab = (typeof PAGES_TABS)[number];

/** Pages (SA-16 to SA-18): three tabs, each with a count of what is waiting. The selected tab is in the URL as `?tab=`. */
export function PagesClient({
  initialTab,
  held,
  reports,
  appeals,
}: {
  initialTab: PagesTab;
  held: HeldPageNameRow[];
  reports: PageReportRow[];
  appeals: PageAppealRow[];
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<PagesTab>(initialTab);

  function select(value: string) {
    const next = (PAGES_TABS as readonly string[]).includes(value) ? (value as PagesTab) : "names";
    setTab(next);
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    params.set("tab", next);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  const openAppeals = appeals.filter((a) => a.decision === null).length;
  const counts: Record<PagesTab, number> = { names: held.length, reports: reports.length, appeals: openAppeals };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">{t("pages.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("pages.hint")}</p>
      </div>
      <Tabs value={tab} onValueChange={select}>
        <TabsList>
          {PAGES_TABS.map((key) => (
            <TabsTrigger key={key} value={key}>
              {t(`pages.tabs.${key}`)}
              {counts[key] > 0 ? <span className="ml-1.5 rounded-full bg-primary/15 px-1.5 text-xs font-medium">{counts[key]}</span> : null}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="names" className="pt-4">
          <HeldNamesClient rows={held} />
        </TabsContent>
        <TabsContent value="reports" className="pt-4">
          <ReportsPanel rows={reports} />
        </TabsContent>
        <TabsContent value="appeals" className="pt-4">
          <AppealsPanel rows={appeals} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
