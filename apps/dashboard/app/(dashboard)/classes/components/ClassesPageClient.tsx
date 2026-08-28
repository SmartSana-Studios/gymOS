"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { CheckCircle2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ClassRow, SessionBookingRow } from "@/services/classes";
import type { CoachRow } from "@/services/coaches";
import type { MemberRole } from "@/services/session";
import { getSessionBookingsAction, markAttendanceAction } from "../actions";
import { ClassModal } from "./ClassModal";

const DAY_KEY = ["classes.days.sun", "classes.days.mon", "classes.days.tue", "classes.days.wed", "classes.days.thu", "classes.days.fri", "classes.days.sat"];

export function ClassesPageClient({
  initialClasses,
  coaches,
  role,
}: {
  initialClasses: ClassRow[];
  coaches: CoachRow[];
  role: MemberRole;
}) {
  const { t, i18n } = useTranslation();
  const [modalOpen, setModalOpen] = useState(false);
  const [editingClass, setEditingClass] = useState<ClassRow | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const router = useRouter();

  // Story 12.3 AC #1: row-expand attendance panel. Only one class row can be
  // expanded at a time -- expandedClassId doubles as both the "which row is
  // open" flag and the key for bookings/bookingsLoading below.
  const [expandedClassId, setExpandedClassId] = useState<string | null>(null);
  const [bookings, setBookings] = useState<SessionBookingRow[]>([]);
  const [bookingsLoading, setBookingsLoading] = useState(false);
  const [markingBookingId, setMarkingBookingId] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  // Matches PlansPageClient's established audit_log_failed toast pattern.
  function showToast(message: string) {
    setToast(message);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 4000);
  }

  // UI-hiding half of AC #3 -- RLS (manager_or_owner_insert_own_classes/
  // manager_or_owner_update_own_classes) is the real enforcement, matching
  // this app's established "Sidebar/button hides, RLS blocks" discipline.
  const canManage = role === "manager" || role === "owner";

  // Story 12.3 AC #1: row-expand/mark-attendance is available to every staff
  // role except Coach -- UI-hiding half, defense-in-depth; the RLS/RPC role
  // checks (mark_class_attendance(), gym_staff_read_own_class_bookings) are
  // the real enforcement, same "Sidebar/button hides, RLS blocks" discipline
  // as canManage above.
  const canMarkAttendance = role !== "coach";

  // Review fix: guards against a stale response overwriting the panel when
  // the expanded row changes again before the in-flight fetch resolves --
  // each call captures which class it's fetching for and discards its
  // result if that class is no longer the one expanded by the time it
  // resolves.
  const expandRequestRef = useRef<string | null>(null);

  async function toggleExpand(cls: ClassRow) {
    if (expandedClassId === cls.id) {
      setExpandedClassId(null);
      setBookings([]);
      expandRequestRef.current = null;
      return;
    }
    if (!cls.nextSessionId) {
      // Nothing to book/mark for a class with no materialized future
      // session -- still expand to show the empty state.
      setExpandedClassId(cls.id);
      setBookings([]);
      expandRequestRef.current = null;
      return;
    }
    setExpandedClassId(cls.id);
    setBookings([]);
    setBookingsLoading(true);
    expandRequestRef.current = cls.id;
    const { data, error } = await getSessionBookingsAction(cls.nextSessionId);
    if (expandRequestRef.current !== cls.id) return;
    setBookingsLoading(false);
    if (error) {
      showToast(t("common.loadError"));
      return;
    }
    setBookings(data ?? []);
  }

  async function handleMarkAttendance(bookingId: string) {
    setMarkingBookingId(bookingId);
    const { data, rejected, error } = await markAttendanceAction(bookingId);
    setMarkingBookingId(null);
    if (error) {
      showToast(t("common.loadError"));
      return;
    }
    if (rejected) {
      // The real-time alert (FrontDeskAlertPanel, Story 4.6/AD-20) surfaces
      // separately via its own existing Realtime subscription -- not
      // triggered from here.
      showToast(t("classes.attendance.memberExpired"));
      return;
    }
    setBookings((prev) => prev.map((b) => (b.id === bookingId ? { ...b, attended: data?.attended ?? true } : b)));
  }

  function openCreate() {
    setEditingClass(null);
    setModalOpen(true);
  }

  function openEdit(cls: ClassRow) {
    setEditingClass(cls);
    setModalOpen(true);
  }

  function scheduleSummary(cls: ClassRow): string {
    if (cls.scheduleType === "one_off") {
      return cls.oneOffSessionAt
        ? new Date(cls.oneOffSessionAt).toLocaleString(i18n.language, {
            dateStyle: "medium",
            timeStyle: "short",
          })
        : "";
    }
    const days = (cls.recurrenceDays ?? []).map((d) => t(DAY_KEY[d])).join(", ");
    // Postgres's `time` column round-trips as "HH:mm:ss" -- slice to "HH:mm"
    // to match ClassModal's formFromClass (Review fix: this previously
    // interpolated the raw value, showing "18:00:00" here while the modal
    // correctly showed "18:00").
    const time = cls.recurrenceTime ? cls.recurrenceTime.slice(0, 5) : "";
    return t("classes.recurringSummary", { days, time });
  }

  function nextSessionLabel(cls: ClassRow): string {
    return cls.nextSessionAt
      ? new Date(cls.nextSessionAt).toLocaleString(i18n.language, { dateStyle: "medium", timeStyle: "short" })
      : t("classes.noUpcomingSession");
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t("classes.title")}</h1>
        {canManage && <Button onClick={openCreate}>{t("classes.addClass")}</Button>}
      </div>

      {initialClasses.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-md border border-dashed py-16 text-center">
          <p className="text-sm text-muted-foreground">{t("classes.emptyNoClasses")}</p>
          {canManage && <Button onClick={openCreate}>{t("classes.addClassButton")}</Button>}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/50 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="p-3 font-medium">{t("classes.columnName")}</th>
                <th className="p-3 font-medium">{t("classes.columnCoach")}</th>
                <th className="p-3 font-medium">{t("classes.columnSchedule")}</th>
                <th className="p-3 font-medium">{t("classes.columnNextSession")}</th>
                <th className="p-3 font-medium">{t("classes.columnBooked")}</th>
                {canManage && <th className="p-3 font-medium" />}
              </tr>
            </thead>
            <tbody className="divide-y">
              {initialClasses.map((cls) => (
                <Fragment key={cls.id}>
                  <tr
                    className={
                      canMarkAttendance
                        ? "cursor-pointer hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                        : undefined
                    }
                    onClick={canMarkAttendance ? () => void toggleExpand(cls) : undefined}
                    onKeyDown={
                      canMarkAttendance
                        ? (e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              void toggleExpand(cls);
                            }
                          }
                        : undefined
                    }
                    tabIndex={canMarkAttendance ? 0 : undefined}
                    role={canMarkAttendance ? "button" : undefined}
                    aria-expanded={canMarkAttendance ? expandedClassId === cls.id : undefined}
                  >
                    <td className="p-3 font-medium">{cls.name}</td>
                    <td className="p-3">{cls.coachName}</td>
                    <td className="p-3">{scheduleSummary(cls)}</td>
                    <td className="p-3">{nextSessionLabel(cls)}</td>
                    <td className="p-3">
                      {cls.bookedCount} / {cls.capacity}
                    </td>
                    {canManage && (
                      <td className="p-3 text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            openEdit(cls);
                          }}
                        >
                          {t("classes.edit")}
                        </Button>
                      </td>
                    )}
                  </tr>
                  {canMarkAttendance && expandedClassId === cls.id && (
                    <tr key={`${cls.id}-attendance`}>
                      <td colSpan={canManage ? 6 : 5} className="bg-muted/10 p-4">
                        {bookingsLoading ? (
                          <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
                            <span className="size-4 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
                            {t("classes.attendance.loadingBookings")}
                          </div>
                        ) : !cls.nextSessionId ? (
                          <p className="text-sm text-muted-foreground">{t("classes.attendance.noSession")}</p>
                        ) : bookings.length === 0 ? (
                          <p className="text-sm text-muted-foreground">{t("classes.attendance.noBookings")}</p>
                        ) : (
                          <ul className="grid gap-2 sm:grid-cols-2">
                            {bookings.map((booking) => (
                              <li
                                key={booking.id}
                                className={`flex items-center justify-between gap-3 rounded-lg border p-2.5 transition-colors ${
                                  booking.attended
                                    ? "border-green-200 bg-green-50"
                                    : "border-border bg-background"
                                }`}
                              >
                                <div className="flex min-w-0 items-center gap-2.5">
                                  <span
                                    className={`flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                                      booking.attended
                                        ? "bg-green-600 text-white"
                                        : "bg-primary/10 text-primary"
                                    }`}
                                  >
                                    {booking.attended ? (
                                      <CheckCircle2 className="size-4" />
                                    ) : (
                                      booking.memberName.slice(0, 1).toUpperCase()
                                    )}
                                  </span>
                                  <span className="truncate text-sm font-medium">{booking.memberName}</span>
                                </div>
                                {booking.attended ? (
                                  <Badge
                                    variant="outline"
                                    className="shrink-0 border-green-200 bg-green-100 text-green-800"
                                  >
                                    <CheckCircle2 className="mr-1 size-3" />
                                    {t("classes.attendance.attended")}
                                  </Badge>
                                ) : (
                                  <Button
                                    size="sm"
                                    disabled={markingBookingId === booking.id}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      void handleMarkAttendance(booking.id);
                                    }}
                                  >
                                    {markingBookingId === booking.id ? (
                                      <span className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                                    ) : (
                                      t("classes.attendance.markAttended")
                                    )}
                                  </Button>
                                )}
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {canManage && (
        <ClassModal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          onSaved={(warning) => {
            setModalOpen(false);
            if (warning) showToast(warning);
            router.refresh();
          }}
          editingClass={editingClass}
          coaches={coaches}
        />
      )}

      {toast && (
        <div
          role="status"
          className="fixed bottom-4 right-4 rounded-md bg-primary px-4 py-3 text-sm text-primary-foreground shadow-lg"
        >
          {toast}
        </div>
      )}
    </div>
  );
}
