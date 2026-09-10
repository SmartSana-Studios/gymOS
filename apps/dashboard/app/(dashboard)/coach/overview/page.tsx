import { Suspense } from "react";

import type { Locale } from "@/lib/i18n/config";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getServerTranslation } from "@/lib/i18n/get-server-translation";
import { listMyClasses } from "@/services/classes";
import {
  listAssignedMemberNoteRecency,
  listAssignedMemberProgressRecency,
  listAssignedMembers,
  type CoachPortalMemberRow,
} from "@/services/coaches";
import { STATUS_BADGE_CONFIG } from "@/app/(dashboard)/subscriptions/subscriptionLabels";
import { gymDateFormatter, gymLocalDaysAgo, relativeDaysFormatter } from "../gymTime";
import {
  FOLLOW_UP_AFTER_DAYS,
  RECENT_PROGRESS_WITHIN_DAYS,
  selectFollowUp,
  selectNextSessions,
  selectRecentProgress,
  type CaseloadSelection,
  type NextSession,
} from "./caseload";
import { CaseloadList, type CaseloadListRow } from "./components/CaseloadList";
import { MembersAtAGlance, type MembersAtAGlanceItem } from "./components/MembersAtAGlance";
import { OverviewWidget } from "./components/OverviewWidget";
import CoachOverviewLoading from "./loading";

type Translate = Awaited<ReturnType<typeof getServerTranslation>>["t"];

// Breakdown order, healthiest first -- the order STATUS_BADGE_CONFIG lists them.
const STATUS_ORDER: CoachPortalMemberRow["status"][] = ["active", "expiring_soon", "grace_period", "expired"];

/**
 * AD-20, the Coach's portal home and landing route -- `(dashboard)/page.tsx`
 * redirects every Coach sign-in here (Story 17.3). Story 17.5 completes it:
 * My Next Sessions, My Members At A Glance, Needs Follow-Up and Recent
 * Progress Activity.
 *
 * Four reads, one `Promise.all`, all scoped to the Coach's own caseload:
 * `listMyClasses()` (Story 17.4's `list_my_classes()`, which resolves the
 * Coach server-side), and three RLS-scoped reads -- `listAssignedMembers()`
 * through 0040's coach policies, and the two member-recency reads through
 * 0040/0041/0067. Nothing is cached: an ended assignment drops the member from
 * every widget on the next load (FR-146). Needs Follow-Up uses session-note
 * recency only; the Coach role has no attendance read and this page does not
 * widen it.
 *
 * Per-widget failure isolation: every service returns `{ data, error }` and
 * never throws, so the `Promise.all` cannot reject, and each widget is built
 * from its own result -- a failed read renders that widget's inline error and
 * nothing else. ONE boundary rather than four, because the layout depends on
 * the member count:
 *  - no assigned members and no upcoming session -> AD-14's guidance alone;
 *  - no assigned members but upcoming sessions (or a failed class read) ->
 *    My Next Sessions beside that guidance, so a class-only Coach still sees
 *    what they teach (decided with the product owner, 2026-09-10);
 *  - otherwise, including a failed member read -> the four-widget grid.
 *
 * The clock is read once, after the request-time reads above, as
 * `cacheComponents` requires, and every day count is a gym-local calendar day
 * (../gymTime.ts). The thresholds live in ./caseload.ts and are interpolated
 * into the copy from there. Every label is formatted here, on the server.
 *
 * Structure mirrors coach/page.tsx: sync default export -> <Suspense> ->
 * async data component. No route-level role guard, per that file's comment.
 */
export default function CoachOverviewPage() {
  return (
    <Suspense fallback={<CoachOverviewLoading />}>
      <CoachOverviewData />
    </Suspense>
  );
}

async function CoachOverviewData() {
  const locale = await getRequestLocale();
  const { t } = await getServerTranslation(locale);
  const [members, classes, noteRecency, progressRecency] = await Promise.all([
    listAssignedMembers({}),
    listMyClasses(),
    listAssignedMemberNoteRecency(),
    listAssignedMemberProgressRecency(),
  ]);
  const now = new Date();

  const loadError = t("common.loadError");
  const nextSessions = classes.error || !classes.data ? null : selectNextSessions(classes.data, now);

  const nextSessionsWidget = (
    <OverviewWidget
      title={t("coachPortal.overview.nextSessions.title")}
      link={{ href: "/coach/classes", label: t("coachPortal.overview.nextSessions.viewAll") }}
    >
      <CaseloadList
        state={nextSessions ? "ready" : "error"}
        errorLabel={loadError}
        emptyLabel={t("coachPortal.overview.nextSessions.empty")}
        rows={nextSessions ? nextSessionRows(nextSessions, locale, t) : []}
        moreLabel={null}
      />
    </OverviewWidget>
  );

  // AD-20's empty state: AD-14's guidance rather than empty member widgets.
  const noAssignments = (
    <div className="flex flex-col items-center gap-3 rounded-md border border-dashed py-16 text-center">
      <p className="text-sm text-muted-foreground">{t("coachPortal.emptyNoAssignments")}</p>
    </div>
  );

  if (!members.error && members.data && members.data.length === 0) {
    if (nextSessions && nextSessions.length === 0) {
      return noAssignments;
    }
    return (
      <div className="grid gap-4 md:grid-cols-2">
        {nextSessionsWidget}
        {noAssignments}
      </div>
    );
  }

  const formatWhen = relativeDaysFormatter(locale);
  const followUp = noteRecency.error || !noteRecency.data ? null : selectFollowUp(noteRecency.data, now);
  const recentProgress =
    progressRecency.error || !progressRecency.data ? null : selectRecentProgress(progressRecency.data, now);

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {nextSessionsWidget}

      <OverviewWidget
        title={t("coachPortal.overview.membersAtAGlance.title")}
        link={{ href: "/coach", label: t("coachPortal.overview.membersAtAGlance.viewAll") }}
      >
        <MembersAtAGlance
          state={members.error || !members.data ? "error" : "ready"}
          errorLabel={loadError}
          total={(members.data?.length ?? 0).toLocaleString(locale)}
          assignedLabel={t("coachPortal.overview.membersAtAGlance.assignedLabel")}
          items={members.error ? [] : statusItems(members.data ?? [], locale, t)}
        />
      </OverviewWidget>

      <OverviewWidget
        title={t("coachPortal.overview.followUp.title")}
        description={t("coachPortal.overview.followUp.description", { days: FOLLOW_UP_AFTER_DAYS })}
      >
        <CaseloadList
          state={followUp ? "ready" : "error"}
          errorLabel={loadError}
          emptyLabel={t("coachPortal.overview.followUp.empty")}
          rows={
            followUp?.rows.map((row) => ({
              key: row.memberId,
              href: `/coach/${row.memberId}`,
              primary: row.memberName,
              secondary:
                row.lastAt === null
                  ? t("coachPortal.overview.followUp.noNoteYet")
                  : t("coachPortal.overview.followUp.lastNote", {
                      when: formatWhen(gymLocalDaysAgo(row.lastAt, now, row.gymTimezone)),
                    }),
            })) ?? []
          }
          moreLabel={moreLabel(followUp, t)}
        />
      </OverviewWidget>

      <OverviewWidget
        title={t("coachPortal.overview.recentProgress.title")}
        description={t("coachPortal.overview.recentProgress.description", { days: RECENT_PROGRESS_WITHIN_DAYS })}
      >
        <CaseloadList
          state={recentProgress ? "ready" : "error"}
          errorLabel={loadError}
          emptyLabel={t("coachPortal.overview.recentProgress.empty", { days: RECENT_PROGRESS_WITHIN_DAYS })}
          rows={
            recentProgress?.rows.map((row) => ({
              key: row.memberId,
              href: `/coach/${row.memberId}?tab=progress`,
              primary: row.memberName,
              secondary: t("coachPortal.overview.recentProgress.logged", {
                when: formatWhen(gymLocalDaysAgo(row.lastAt, now, row.gymTimezone)),
              }),
            })) ?? []
          }
          moreLabel={moreLabel(recentProgress, t)}
        />
      </OverviewWidget>
    </div>
  );
}

/** My Next Sessions rows: the session time in the gym's zone (one formatter per
 * timezone, not per row), the class, and its booked count; each links to that
 * class's section on My Classes, which expands it from the hash. */
function nextSessionRows(sessions: NextSession[], locale: Locale, t: Translate): CaseloadListRow[] {
  const formatters = new Map<string, (iso: string) => string>();

  return sessions.map((session) => {
    let formatDate = formatters.get(session.gymTimezone);
    if (!formatDate) {
      formatDate = gymDateFormatter(locale, session.gymTimezone);
      formatters.set(session.gymTimezone, formatDate);
    }
    return {
      key: session.classSessionId,
      href: `/coach/classes#class-${session.classId}`,
      primary: formatDate(session.scheduledAt),
      secondary: session.className,
      meta: t("coachPortal.classes.bookedCount", {
        booked: session.bookedCount.toLocaleString(locale),
        capacity: session.capacity.toLocaleString(locale),
      }),
    };
  });
}

/** My Members At A Glance: one badge per status that has members, healthiest
 * first, reusing the `members.status.*` labels. */
function statusItems(members: CoachPortalMemberRow[], locale: Locale, t: Translate): MembersAtAGlanceItem[] {
  const counts = new Map<CoachPortalMemberRow["status"], number>();
  for (const row of members) {
    counts.set(row.status, (counts.get(row.status) ?? 0) + 1);
  }

  return STATUS_ORDER.filter((status) => counts.has(status)).map((status) => ({
    status,
    label: t(STATUS_BADGE_CONFIG[status].labelKey),
    count: (counts.get(status) ?? 0).toLocaleString(locale),
  }));
}

function moreLabel(selection: CaseloadSelection | null, t: Translate): string | null {
  return selection && selection.moreCount > 0 ? t("coachPortal.overview.moreCount", { count: selection.moreCount }) : null;
}
