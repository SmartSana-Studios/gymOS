"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import type { ClassRow } from "@/services/classes";
import type { CoachRow } from "@/services/coaches";
import type { MemberRole } from "@/services/session";
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
                <tr key={cls.id}>
                  <td className="p-3 font-medium">{cls.name}</td>
                  <td className="p-3">{cls.coachName}</td>
                  <td className="p-3">{scheduleSummary(cls)}</td>
                  <td className="p-3">{nextSessionLabel(cls)}</td>
                  <td className="p-3">
                    {cls.bookedCount} / {cls.capacity}
                  </td>
                  {canManage && (
                    <td className="p-3 text-right">
                      <Button variant="outline" size="sm" onClick={() => openEdit(cls)}>
                        {t("classes.edit")}
                      </Button>
                    </td>
                  )}
                </tr>
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
