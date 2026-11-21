import { Suspense } from "react";
import { redirect } from "next/navigation";

import { listAssignedMembers } from "@/services/coaches";
import { listCoachAssignedMembers } from "@/services/coachPicker";
import { CoachPortalPageClient } from "./components/CoachPortalPageClient";
import { CoachPickerNotice } from "./components/CoachPickerStates";
import { resolvePicker } from "./pickerContext";
import CoachPortalLoading from "./loading";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getServerTranslation } from "@/lib/i18n/get-server-translation";

/**
 * AD-14 Coach Portal -- assigned member list. Server Component + explicit
 * <Suspense>, mirroring subscriptions/page.tsx's exact structure (cookie-
 * based Supabase read under this app's `cacheComponents: true`).
 *
 * Story 29.4 (FR-247): the one role guard is coach/layout.tsx (a Receptionist or GymOS Support gets the permission message and this page never runs).
 * For an Owner, Supervisor or Manager this is the picker's Members tab: the chosen coach is `?coach=<id>` (read here, on the server), the list comes from
 * `list_coach_assigned_members`, and nothing is read before a coach is chosen. A single active coach is pre-selected by redirecting to Classes. For the Coach
 * role nothing changes: a typed `?coach=` is never read, and the list is the caller's own RLS-scoped read. The resolved screen comes from ./pickerContext.ts.
 */
export default function CoachPortalPage({
  searchParams,
}: {
  searchParams: Promise<PortalSearchParams>;
}) {
  return (
    <Suspense fallback={<CoachPortalLoading />}>
      <CoachPortalData searchParams={searchParams} />
    </Suspense>
  );
}

type PortalSearchParams = { search?: string; sort?: string; dir?: string; coach?: string | string[] };

async function CoachPortalData({
  searchParams,
}: {
  searchParams: Promise<PortalSearchParams>;
}) {
  const params = await searchParams;
  const picker = await resolvePicker(params.coach);

  if (picker.kind === "single") {
    redirect(`/coach/classes?coach=${encodeURIComponent(picker.coachId)}`);
  }
  if (picker.kind === "error") {
    const { t } = await getServerTranslation(await getRequestLocale());
    return <div className="text-sm text-red-600">{t("common.loadError")}</div>;
  }
  if (picker.kind === "ready") {
    const { data: pickerMembers, error: pickerError } = await listCoachAssignedMembers(picker.coach.id, {
      search: params.search,
      sort: params.sort,
      dir: params.dir,
    });
    if (pickerError || !pickerMembers) {
      const { t } = await getServerTranslation(await getRequestLocale());
      return <div className="text-sm text-red-600">{t("common.loadError")}</div>;
    }
    return (
      <CoachPortalPageClient
        members={pickerMembers}
        search={params.search ?? ""}
        sort={params.sort ?? "name"}
        dir={params.dir ?? "asc"}
        picker={{ coachId: picker.coach.id, coachName: picker.coach.name }}
      />
    );
  }
  if (picker.kind !== "own") {
    return <CoachPickerNotice state={picker} />;
  }

  const { data: members, error } = await listAssignedMembers({
    search: params.search,
    sort: params.sort,
    dir: params.dir,
  });

  if (error) {
    const { t } = await getServerTranslation(await getRequestLocale());
    return <div className="text-sm text-red-600">{t("common.loadError")}</div>;
  }

  return (
    <CoachPortalPageClient
      members={members ?? []}
      search={params.search ?? ""}
      sort={params.sort ?? "name"}
      dir={params.dir ?? "asc"}
    />
  );
}
