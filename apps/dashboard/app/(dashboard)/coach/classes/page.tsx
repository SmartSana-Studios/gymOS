import { Suspense } from "react";

import type { Locale } from "@/lib/i18n/config";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getServerTranslation } from "@/lib/i18n/get-server-translation";
import { listMyClasses, type CoachClassRow } from "@/services/classes";
import { gymDateFormatter } from "../gymTime";
import { CoachClassesPageClient, type CoachClassView } from "./components/CoachClassesPageClient";
import CoachClassesLoading from "./loading";

type Translate = Awaited<ReturnType<typeof getServerTranslation>>["t"];

// Postgres's extract(dow) order, the one classes.recurrence_days stores
// (0057) -- copied from ClassesPageClient.tsx rather than imported from a
// client component, per this app's per-file-copy convention.
const DAY_KEY = ["classes.days.sun", "classes.days.mon", "classes.days.tue", "classes.days.wed", "classes.days.thu", "classes.days.fri", "classes.days.sat"];

/**
 * Story 17.4: AD-21, the Coach Portal's My Classes page (FR-145) -- the
 * classes this Coach teaches, their sessions from 00:00 today in the gym's
 * timezone onward with booked counts, and (lazily, per session) who is booked.
 * Replaces Story 17.3's route shell.
 *
 * One read, `listMyClasses()`, over the `list_my_classes()` SECURITY DEFINER
 * RPC (0096). Plain reads cannot build this page: a Coach has no RLS read on
 * `class_bookings`, nor on the names of members they are not assigned to. The
 * RPC resolves the Coach server-side from the session -- never from a
 * client-supplied coach id -- and returns nothing for any other role, so a
 * manager or owner who opens this URL sees the empty state. No route-level
 * role guard, per coach/page.tsx's documented precedent.
 *
 * Every date, number and label is formatted HERE, in the gym's own timezone,
 * and the client component receives strings only. Formatting a timestamp in
 * a client component with no `timeZone` renders in UTC on the server and in
 * the browser's zone on the client -- the hydration mismatch deferred-work.md
 * records against CheckedInTable and the admin Classes page. The formatter
 * lives in ../gymTime.ts, shared with the Portal's Overview (Story 17.5).
 *
 * Read-only: no create, edit, reschedule or mark-attendance control exists
 * anywhere on this route, and none is gated by a role flag -- they are simply
 * not built. The Portal heading comes from coach/layout.tsx.
 */
export default function CoachClassesPage() {
  return (
    <Suspense fallback={<CoachClassesLoading />}>
      <CoachClassesData />
    </Suspense>
  );
}

async function CoachClassesData() {
  const locale = await getRequestLocale();
  const { t } = await getServerTranslation(locale);
  const { data: classes, error } = await listMyClasses();

  if (error || !classes) {
    return <div className="text-sm text-red-600">{t("common.loadError")}</div>;
  }

  // AD-21's empty state, in AD-14's dashed box (coach/overview/page.tsx). A
  // class with no session in the window still counts as a class here, so this
  // only ever shows for a Coach who genuinely teaches nothing.
  if (classes.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-md border border-dashed py-16 text-center">
        <p className="text-sm text-muted-foreground">{t("coachPortal.classes.emptyNoClasses")}</p>
      </div>
    );
  }

  return <CoachClassesPageClient classes={toClassViews(classes, locale, t)} />;
}

function toClassViews(classes: CoachClassRow[], locale: Locale, t: Translate): CoachClassView[] {
  // list_my_classes() repeats the gym's timezone on every row, so one set of
  // formatters serves the whole page.
  const formatDate = gymDateFormatter(locale, classes[0].gymTimezone);

  return classes.map((cls) => {
    const capacity = cls.capacity.toLocaleString(locale);
    return {
      classId: cls.classId,
      className: cls.className,
      scheduleLabel: scheduleLabel(cls, formatDate, t),
      capacityLabel: t("coachPortal.classes.capacity", { capacity }),
      sessions: cls.sessions.map((session) => ({
        classSessionId: session.classSessionId,
        label: formatDate(session.scheduledAt),
        bookedLabel: t("coachPortal.classes.bookedCount", {
          booked: session.bookedCount.toLocaleString(locale),
          capacity,
        }),
      })),
    };
  });
}

function scheduleLabel(cls: CoachClassRow, formatDate: (iso: string) => string, t: Translate): string {
  if (cls.scheduleType === "one_off") {
    return cls.oneOffSessionAt ? formatDate(cls.oneOffSessionAt) : "";
  }
  const days = (cls.recurrenceDays ?? []).map((d) => t(DAY_KEY[d])).join(", ");
  // recurrence_time is already gym-local wall-clock time, round-tripped as
  // "HH:mm:ss" -- sliced, never timezone-converted.
  const time = cls.recurrenceTime ? cls.recurrenceTime.slice(0, 5) : "";
  return t("classes.recurringSummary", { days, time });
}
