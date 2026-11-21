import { Suspense } from "react";
import { redirect } from "next/navigation";

import { getMemberDetail, getMemberProgressData, listSessionNotes } from "@/services/coaches";
import { getWorkoutPlan } from "@/services/workoutPlans";
import { listExerciseLibrary } from "@/services/exercises";
import { CoachMemberDetailPageClient, type CoachMemberDetailTab } from "./components/CoachMemberDetailPageClient";
import CoachMemberDetailLoading from "./loading";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getServerTranslation } from "@/lib/i18n/get-server-translation";
import { getCoachAssignedMember, getCoachMemberWorkoutPlan, listCoachMemberSessionNotes } from "@/services/coachPicker";
import { CoachPickerNotice } from "../components/CoachPickerStates";
import { resolvePicker, UUID_RE } from "../pickerContext";
import { CoachPickerMemberDetail, type PickerMemberTab } from "./components/CoachPickerMemberDetail";

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
 * Story 29.4 (UX AD-32, picker mode of AD-15): for an Owner, Supervisor or Manager the same address with `?coach=<id>` is a member of that coach, read-only,
 * through the picker's own reads only (`get_coach_assigned_member`, `list_coach_member_session_notes`, `get_coach_member_workout_plan`). `getMemberDetail`
 * (which selects the starting weight), `getWorkoutPlan` (which reads plan completions), `getMemberProgressData` and the exercise library are never called in
 * picker mode, and nothing of ./actions.ts is imported by the picker's components. A member not currently assigned to the chosen coach shows "not assigned",
 * never the profile; a Progress address (`?tab=progress`) shows one "part unavailable" message and reads nothing. For the Coach role nothing changes.
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
  searchParams: Promise<{ tab?: string | string[]; coach?: string | string[] }>;
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
  searchParams: Promise<{ tab?: string | string[]; coach?: string | string[] }>;
}) {
  const [{ memberId }, { tab, coach: coachParam }] = await Promise.all([params, searchParams]);
  const progressAddress = tab === "progress" || (Array.isArray(tab) && tab.includes("progress"));
  const picker = await resolvePicker(coachParam);

  if (picker.kind === "single") {
    // A repeated or other `tab` is not carried: only the two values the page reads are kept, so a Progress address still reaches its message.
    const keepTab = tab === "progress" || tab === "workout-plan" ? `&tab=${tab}` : progressAddress ? "&tab=progress" : "";
    redirect(`/coach/${encodeURIComponent(memberId)}?coach=${encodeURIComponent(picker.coachId)}${keepTab}`);
  }
  if (picker.kind === "error") {
    const { t } = await getServerTranslation(await getRequestLocale());
    return <div className="text-sm text-red-600">{t("common.loadError")}</div>;
  }
  if (picker.kind === "ready") {
    if (progressAddress) {
      return <CoachPickerNotice state={{ kind: "partUnavailable", coachId: picker.coach.id }} />;
    }
    if (!UUID_RE.test(memberId)) {
      return <CoachPickerNotice state={{ kind: "notAssigned", coachId: picker.coach.id, coachName: picker.coach.name }} />;
    }
    const [
      { data: header, error: headerError },
      { data: pickerNotes, error: pickerNotesError },
      { data: pickerPlan, error: pickerPlanError },
    ] = await Promise.all([
      getCoachAssignedMember(picker.coach.id, memberId),
      listCoachMemberSessionNotes(picker.coach.id, memberId),
      getCoachMemberWorkoutPlan(picker.coach.id, memberId),
    ]);
    if (headerError || pickerNotesError || pickerPlanError) {
      const { t } = await getServerTranslation(await getRequestLocale());
      return <div className="text-sm text-red-600">{t("common.loadError")}</div>;
    }
    if (!header) {
      return <CoachPickerNotice state={{ kind: "notAssigned", coachId: picker.coach.id, coachName: picker.coach.name }} />;
    }
    const pickerTab: PickerMemberTab = tab === "workout-plan" ? "workout-plan" : "session-notes";
    return (
      <CoachPickerMemberDetail member={header} notes={pickerNotes ?? []} plan={pickerPlan} coachId={picker.coach.id} initialTab={pickerTab} />
    );
  }
  if (picker.kind !== "own") {
    return <CoachPickerNotice state={picker} />;
  }

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
