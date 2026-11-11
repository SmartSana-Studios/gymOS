import { Suspense } from "react";

import { LoadError } from "@/components/load-error";

import { listHeldPageNames } from "../page-names/actions";
import { listActivePages, listPageAppeals, listPageReports } from "./actions";
import PagesLoading from "./loading";
import { PagesClient } from "./components/PagesClient";
import { parsePagesTab } from "./tabs";

// SA-16 / SA-17 / SA-18 (Story 24.11): Pages, with the tabs Held names, Reports, Appeals and Active. The selected tab is in the URL (`?tab=`).
export default function PagesPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  return (
    <Suspense fallback={<PagesLoading />}>
      <PagesData searchParams={searchParams} />
    </Suspense>
  );
}

async function PagesData({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams;
  const initialTab = parsePagesTab(tab);
  const [held, reports, appeals, active] = await Promise.all([listHeldPageNames(), listPageReports(), listPageAppeals(), listActivePages()]);
  if (held.error || !held.data || reports.error || !reports.data || appeals.error || !appeals.data) return <LoadError />;
  // The Active list has its own failure state: if its database function is missing or fails, Names, Reports and Appeals still work.
  return <PagesClient initialTab={initialTab} held={held.data} reports={reports.data} appeals={appeals.data} active={active.error ? null : active.data} />;
}
