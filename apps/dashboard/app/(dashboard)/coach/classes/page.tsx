import { Suspense } from "react";
import { redirect } from "next/navigation";

import type { Locale } from "@/lib/i18n/config";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getServerTranslation } from "@/lib/i18n/get-server-translation";
import { summarizeSlots } from "@/lib/classTimes";
import { getClassesGymTimezone, listMyClasses, type ClassRow, type CoachClassRow } from "@/services/classes";
import { getDashboardShellContext } from "@/services/session";
import { listCoachClasses } from "@/services/coachPicker";
import { gymDateFormatter } from "../gymTime";
import { CoachPickerNotice } from "../components/CoachPickerStates";
import { resolvePicker } from "../pickerContext";
import { CoachClassesPageClient, type CoachClassView, type CoachIdentity } from "./components/CoachClassesPageClient";
import CoachClassesLoading from "./loading";

type Translate = Awaited<ReturnType<typeof getServerTranslation>>["t"];

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
 * Story 29.3 (UX AD-21 V1.8): a Coach also creates, edits and cancels their own classes here. The signed-in Coach (member id and name) is
 * resolved on the server from the shell context and handed to the client as `coach`; the client never types or sends it, and the database
 * (create_class, update_class, cancel_class, 0182) is the authority on whose classes may change. Any other role gets the list exactly as
 * before, with no control. Roster and attendance stay read-only: no mark-attendance control exists on this route. The Portal heading comes from
 * coach/layout.tsx.
 *
 * Story 29.4 (UX AD-32): for an Owner, Supervisor or Manager this is the picker's Classes tab (the default tab): the chosen coach's classes, read-only, from
 * `list_coach_classes` through the same `toClassViews` and the same list component, which then has no control (`coach` is null) and a link per class to the
 * admin Classes page. The chosen coach is `?coach=<id>`, read here; nothing is read before one is chosen (a single active coach is pre-selected by redirect).
 * The Coach role never reads `?coach=`: `own` is today's behaviour, byte for byte.
 */
export default function CoachClassesPage({ searchParams }: { searchParams: Promise<{ coach?: string | string[] }> }) {
  return (
    <Suspense fallback={<CoachClassesLoading />}>
      <CoachClassesData searchParams={searchParams} />
    </Suspense>
  );
}

async function CoachClassesData({ searchParams }: { searchParams: Promise<{ coach?: string | string[] }> }) {
  const locale = await getRequestLocale();
  const { t } = await getServerTranslation(locale);
  const { coach: coachParam } = await searchParams;
  const picker = await resolvePicker(coachParam);

  if (picker.kind === "single") {
    redirect(`/coach/classes?coach=${encodeURIComponent(picker.coachId)}`);
  }
  if (picker.kind === "error") {
    return <div className="text-sm text-red-600">{t("common.loadError")}</div>;
  }
  if (picker.kind === "ready") {
    const { data: pickerClasses, error: pickerError } = await listCoachClasses(picker.coach.id);
    if (pickerError || !pickerClasses) {
      return <div className="text-sm text-red-600">{t("common.loadError")}</div>;
    }
    return (
      <CoachClassesPageClient
        classes={toClassViews(pickerClasses, locale, t, null)}
        picker={{ coachId: picker.coach.id, coachName: picker.coach.name }}
      />
    );
  }
  if (picker.kind !== "own") {
    return <CoachPickerNotice state={picker} />;
  }

  const [{ data: classes, error }, { data: shell, error: shellError }] = await Promise.all([
    listMyClasses(),
    getDashboardShellContext(),
  ]);

  if (error || !classes || shellError) {
    return <div className="text-sm text-red-600">{t("common.loadError")}</div>;
  }

  const coach: CoachIdentity | null =
    shell?.role === "coach" && shell.memberId ? { id: shell.memberId, name: shell.memberName } : null;
  const { data: gymTimezone } = coach ? await getClassesGymTimezone() : { data: null };

  // AD-21's empty state, in AD-14's dashed box (coach/overview/page.tsx), is drawn by the client so a Coach gets [+ Create class] in it. A
  // class with no session in the window still counts as a class here, so it only ever shows for a Coach who genuinely teaches nothing.
  return (
    <CoachClassesPageClient
      classes={toClassViews(classes, locale, t, coach)}
      coach={coach}
      gymTimezone={gymTimezone ?? classes[0]?.gymTimezone ?? null}
    />
  );
}

function toClassViews(classes: CoachClassRow[], locale: Locale, t: Translate, coach: CoachIdentity | null): CoachClassView[] {
  if (classes.length === 0) return [];
  // list_my_classes() repeats the gym's timezone on every row, so one set of
  // formatters serves the whole page.
  const formatDate = gymDateFormatter(locale, classes[0].gymTimezone);
  const nowMs = Date.now();

  return classes.map((cls) => {
    const capacity = cls.capacity.toLocaleString(locale);
    return {
      classId: cls.classId,
      className: cls.className,
      scheduleLabel: scheduleLabel(cls, formatDate, t),
      capacityLabel: t("coachPortal.classes.capacity", { capacity }),
      ...(cls.cancelledAt ? { cancelledLabel: t("classes.cancel.badge") } : {}),
      ...(coach ? { editRow: toEditRow(cls, coach, nowMs) } : {}),
      sessions: cls.sessions.map((session) => ({
        classSessionId: session.classSessionId,
        label: formatDate(session.scheduledAt),
        bookedLabel: t("coachPortal.classes.bookedCount", {
          booked: session.bookedCount.toLocaleString(locale),
          capacity,
        }),
        ...(session.matchesSlots !== false ? {} : { oldTimeLabel: t("classes.times.oldTimeTag") }),
      })),
    };
  });
}

function scheduleLabel(cls: CoachClassRow, formatDate: (iso: string) => string, t: Translate): string {
  if (cls.scheduleType === "one_off") {
    return cls.oneOffSessionAt ? formatDate(cls.oneOffSessionAt) : "";
  }
  // Slot start times are gym-local wall-clock times ("HH:mm"), never timezone-converted; grouped by hour, Monday first (Story 29.2).
  return summarizeSlots(cls.slots, t).full;
}

/** Story 29.3: the class as the Edit modal and the Cancel class dialog read it. The dialog's booking count is the sum of the booked counts of
 * the class's sessions later than now (`list_my_classes()` leaves out cancelled sessions), the figure the server counts when it cancels. */
function toEditRow(cls: CoachClassRow, coach: CoachIdentity, nowMs: number): ClassRow {
  const upcoming = cls.sessions.filter((session) => new Date(session.scheduledAt).getTime() > nowMs);
  const next = upcoming[0] ?? null;
  return {
    id: cls.classId,
    name: cls.className,
    description: cls.description ?? null,
    coachId: coach.id,
    coachName: coach.name,
    capacity: cls.capacity,
    scheduleType: cls.scheduleType,
    oneOffSessionAt: cls.oneOffSessionAt,
    slots: cls.slots,
    recurrenceStartDate: cls.recurrenceStartDate ?? null,
    cancelledAt: cls.cancelledAt,
    upcomingBookingCount: upcoming.reduce((sum, session) => sum + session.bookedCount, 0),
    nextSessionMatchesSlots: next ? (next.matchesSlots ?? true) : null,
    nextSessionAt: next ? next.scheduledAt : null,
    nextSessionId: next ? next.classSessionId : null,
    bookedCount: next ? next.bookedCount : 0,
  };
}
