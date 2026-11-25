"use client";

import Link from "next/link";
import { useTranslation } from "react-i18next";

/**
 * Story 29.4 (UX AD-32): the picker's messages in place of a page's content. Each one is "the server returned nothing" turned into words: the UI never
 * says more than that (a coach of another gym and a random id read the same). Copy is Group G of the UX contract (coach.picker.*).
 *
 *   choose        nothing chosen yet: the select (in the layout) is focused, and no coach data was loaded
 *   noCoaches     the gym has no coach: an [Open Staff] link for Owner and Supervisor, a plain line for Manager (who cannot reach Staff)
 *   unavailable   the coach is not in this gym, or is not a coach (the select is cleared)
 *   inactive      the coach was deactivated (reached only by a stale link)
 *   partUnavailable  a direct address of an excluded part (the Overview, a member's Progress tab): one message with links to Classes and Members, never content
 *   notAssigned   the member is not currently assigned to the chosen coach: never the profile
 */
export type CoachPickerState =
  | { kind: "choose" }
  | { kind: "no-coaches"; canOpenStaff: boolean }
  | { kind: "unavailable" }
  | { kind: "inactive"; name: string }
  | { kind: "partUnavailable"; coachId: string | null }
  | { kind: "notAssigned"; coachId: string; coachName: string };

const BOX = "rounded-md border border-dashed py-12 px-4 text-center text-sm text-muted-foreground";

export function CoachPickerNotice({ state }: { state: CoachPickerState }) {
  const { t } = useTranslation();

  switch (state.kind) {
    case "choose":
      return <p className={BOX}>{t("coach.picker.choose")}</p>;
    case "no-coaches":
      return (
        <div className={`${BOX} space-y-3`}>
          <p>{state.canOpenStaff ? t("coach.picker.noCoaches") : t("coach.picker.noCoachesManager")}</p>
          {state.canOpenStaff && (
            <Link href="/settings/staff" className="text-primary hover:underline">
              {t("coach.picker.openStaff")}
            </Link>
          )}
        </div>
      );
    case "unavailable":
      return <p className={BOX}>{t("coach.picker.unavailable")}</p>;
    case "inactive":
      return <p className={BOX}>{t("coach.picker.inactive", { name: state.name })}</p>;
    case "partUnavailable": {
      const query = state.coachId ? `?coach=${encodeURIComponent(state.coachId)}` : "";
      return (
        <div role="status" className={`${BOX} space-y-3`}>
          <p>{t("coach.picker.partUnavailable")}</p>
          <p className="flex justify-center gap-6">
            <Link href={`/coach/classes${query}`} className="text-primary hover:underline">
              {t("coach.picker.tab.classes")}
            </Link>
            <Link href={`/coach${query}`} className="text-primary hover:underline">
              {t("coach.picker.tab.members")}
            </Link>
          </p>
        </div>
      );
    }
    case "notAssigned":
      return (
        <div className={`${BOX} space-y-3`}>
          <p>{t("coach.picker.notAssigned", { member: t("coach.picker.thisMember"), coach: state.coachName })}</p>
          <Link href={`/coach?coach=${encodeURIComponent(state.coachId)}`} className="text-primary hover:underline">
            {t("coach.picker.backToMembers")}
          </Link>
        </div>
      );
  }
}
