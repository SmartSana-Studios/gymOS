import { Suspense } from "react";

import { LoadError } from "@/components/load-error";

import { listHeldPageNames } from "../page-names/actions";
import { listPageAppeals, listPageReports } from "./actions";
import PagesLoading from "./loading";
import { PAGES_TABS, PagesClient, type PagesTab } from "./components/PagesClient";

// SA-16 / SA-17 / SA-18 (Story 24.11): Pages, with the tabs Held names, Reports and Appeals. The selected tab is in the URL (`?tab=`).
export default function PagesPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  return (
    <Suspense fallback={<PagesLoading />}>
      <PagesData searchParams={searchParams} />
    </Suspense>
  );
}

async function PagesData({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams;
  const initialTab: PagesTab = (PAGES_TABS as readonly string[]).includes(tab ?? "") ? (tab as PagesTab) : "names";
  const [held, reports, appeals] = await Promise.all([listHeldPageNames(), listPageReports(), listPageAppeals()]);
  if (held.error || !held.data || reports.error || !reports.data || appeals.error || !appeals.data) return <LoadError />;
  return <PagesClient initialTab={initialTab} held={held.data} reports={reports.data} appeals={appeals.data} />;
}
