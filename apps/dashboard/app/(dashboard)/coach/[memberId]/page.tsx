import { Suspense } from "react";

import { getMemberDetail, getMemberProgressData, listSessionNotes } from "@/services/coaches";
import { getWorkoutPlan } from "@/services/workoutPlans";
import { listExerciseLibrary } from "@/services/exercises";
import { CoachMemberDetailPageClient, type CoachMemberDetailTab } from "./components/CoachMemberDetailPageClient";
import CoachMemberDetailLoading from "./loading";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getServerTranslation } from "@/lib/i18n/get-server-translation";

/**
 * AD-15 Coach Portal -- member detail & session notes. Server Component +
 * explicit <Suspense>, mirroring coach/page.tsx's exact structure. First
 * dynamic-segment (`[param]`) route in this app -- `params` is a `Promise`
 * under this app's `cacheComponents: true`, same as `searchParams` already
 * is on every other dashboard page.
 *
 * No route-level role guard beyond `(dashboard)/layout.tsx`'s existing
 * gym-staff gate -- same "Sidebar hides it, RLS is the real gate" precedent
 * every other page in this app documents on itself.
 *
 * Story 17.5 (AC #12): `?tab=progress` or `?tab=workout-plan` opens that tab,
 * so the Coach Portal Overview's Recent Progress rows land on Progress. The
 * Tabs stay uncontrolled: switching tabs does not rewrite the URL.
 */
export default function CoachMemberDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ memberId: string }>;
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  return (
    <Suspense fallback={<CoachMemberDetailLoading />}>
      <CoachMemberDetailData params={params} searchParams={searchParams} />
    </Suspense>
  );
}

/** Only an exact, known tab name opens a tab; anything else -- a missing,
 * repeated, misspelt or differently-cased value -- lands on Session Notes, the
 * page's default. */
function resolveInitialTab(tab: string | string[] | undefined): CoachMemberDetailTab {
  return tab === "progress" || tab === "workout-plan" ? tab : "session-notes";
}

async function CoachMemberDetailData({
  params,
  searchParams,
}: {
  params: Promise<{ memberId: string }>;
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const [{ memberId }, { tab }] = await Promise.all([params, searchParams]);
  const [
    { data: member, error: memberError },
    { data: notes, error: notesError },
    { data: progressData, error: progressError },
    { data: plan, canCreatePlan, error: planError },
    { data: exerciseLibrary, error: exerciseLibraryError },
  ] = await Promise.all([
    getMemberDetail(memberId),
    listSessionNotes(memberId),
    getMemberProgressData(memberId),
    getWorkoutPlan(memberId),
    listExerciseLibrary(),
  ]);

  // Not a Next.js notFound() 404 -- matches this app's established pattern
  // of every other page rendering its own inline error state
  // (coach/page.tsx, subscriptions/page.tsx) rather than throwing. Covers
  // this story's implicit AC: a member not assigned to the calling coach
  // (or nonexistent, or cross-gym) never leaks data or crashes.
  if (memberError || !member) {
    const { t } = await getServerTranslation(await getRequestLocale());
    return <div className="text-sm text-red-600">{t("coachPortal.detail.notFound")}</div>;
  }
  if (notesError) {
    const { t } = await getServerTranslation(await getRequestLocale());
    return <div className="text-sm text-red-600">{t("common.loadError")}</div>;
  }
  if (progressError || !progressData) {
    const { t } = await getServerTranslation(await getRequestLocale());
    return <div className="text-sm text-red-600">{t("common.loadError")}</div>;
  }
  if (planError) {
    const { t } = await getServerTranslation(await getRequestLocale());
    return <div className="text-sm text-red-600">{t("common.loadError")}</div>;
  }
  if (exerciseLibraryError) {
    const { t } = await getServerTranslation(await getRequestLocale());
    return <div className="text-sm text-red-600">{t("common.loadError")}</div>;
  }

  return (
    <CoachMemberDetailPageClient
      member={member}
      notes={notes ?? []}
      progressData={progressData}
      plan={plan}
      canCreatePlan={canCreatePlan}
      exerciseLibrary={exerciseLibrary ?? []}
      initialTab={resolveInitialTab(tab)}
    />
  );
}
