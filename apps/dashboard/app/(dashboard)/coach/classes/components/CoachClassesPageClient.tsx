"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { ArrowRight, CheckCircle2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ClassRow, CoachRosterRow } from "@/services/classes";
import { CancelClassDialog } from "../../../classes/components/CancelClassDialog";
import { ClassModal } from "../../../classes/components/ClassModal";
import { getMySessionRosterAction } from "../actions";
import { getCoachSessionRosterAction } from "../pickerActions";

/** One session row, every label already formatted on the server in the gym's
 * timezone (coach/classes/page.tsx). */
export interface CoachClassSessionView {
  classSessionId: string;
  label: string;
  bookedLabel: string;
  /** Story 29.2: set (the translated tag) when the session was kept on an old time after a weekly-times edit. */
  oldTimeLabel?: string;
}

export interface CoachClassView {
  classId: string;
  className: string;
  scheduleLabel: string;
  capacityLabel: string;
  /** Story 29.2: set (the translated badge text) for a cancelled class. */
  cancelledLabel?: string;
  /** Story 29.3: what the Edit modal and the Cancel class dialog need, built on the server (the booking count is the sum of the booked counts
   * of this class's sessions later than now). Used only when the page is given the signed-in `coach`. */
  editRow?: ClassRow;
  sessions: CoachClassSessionView[];
}

/** Story 29.3: the signed-in Coach, resolved on the server from the shell context (never typed or sent by the client). */
export interface CoachIdentity {
  id: string;
  name: string;
}

/** Story 29.4: the chosen coach, in picker mode (Owner, Supervisor, Manager). The page is then read-only by construction: `coach` is null, so no create, edit or
 * cancel control exists; the rosters come from the picker's read-only action; and each class links to the admin Classes page, where editing already lives. */
export interface ClassesPicker {
  coachId: string;
  coachName: string;
}

type ExpandedSession = {
  classSessionId: string;
  status: "loading" | "error" | "ready";
  rows: CoachRosterRow[];
};

/**
 * Story 17.4 (AC #11): AD-21's class list. The roster is read-only by construction: no mark-attendance control, checkbox or booking
 * add/remove exists in this file.
 *
 * Story 29.3 (UX AD-21 V1.8): when the page passes the signed-in `coach`, a Coach also gets [+ Create class] and, on each live class, [Edit] and
 * [Cancel class] (beside the row's disclosure button, not inside it), opening 29.2's modal in Coach mode and its Cancel dialog. Without
 * `coach` (any other role, and the read-only picker of Story 29.4) none of those controls exist and the list is exactly as before.
 *
 * Classes expand independently. One session is expanded at a time across the
 * page, and its roster is fetched on EVERY expand, with no client cache, so
 * attendance marked at the front desk shows on the next expand.
 *
 * Stale responses are dropped with a request counter rather than a session id
 * (ClassesPageClient's guard): with an id, collapsing and re-expanding the
 * same session would let the first, stale response through. Every expand and
 * every collapse -- of a session, or of the class holding it -- moves the
 * counter on.
 *
 * Story 17.5 (AC #5): arriving with `#class-<id>` -- a My Next Sessions row on
 * the Portal Overview -- opens that class and scrolls it into view. It runs on
 * mount and on `hashchange` only, never when `classes` changes, so a
 * `router.refresh()` cannot re-open a class the Coach collapsed. (Returning
 * with Back does re-open it: Next keeps visited routes in <Activity> and
 * re-runs their effects -- expected.) It opens the class only; no session
 * expands and no roster is fetched.
 */
export function CoachClassesPageClient({
  classes,
  coach = null,
  gymTimezone = null,
  picker = null,
}: {
  classes: CoachClassView[];
  coach?: CoachIdentity | null;
  gymTimezone?: string | null;
  picker?: ClassesPicker | null;
}) {
  const { t } = useTranslation();
  const [modal, setModal] = useState<{ open: boolean; editing: ClassRow | null }>({ open: false, editing: null });
  const [cancelling, setCancelling] = useState<ClassRow | null>(null);
  const editButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const cancelButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const [openClassIds, setOpenClassIds] = useState<Set<string>>(() => new Set());
  const [expanded, setExpanded] = useState<ExpandedSession | null>(null);
  const requestSeq = useRef(0);
  // The hash effect reads the current class ids through this ref, so it needs
  // no dependency on `classes`. Never assigned during render.
  const classIdsRef = useRef(classes.map((cls) => cls.classId));

  useEffect(() => {
    classIdsRef.current = classes.map((cls) => cls.classId);
  }, [classes]);

  useEffect(() => {
    function openFromHash() {
      const classId = classIdsRef.current.find((id) => window.location.hash === `#class-${id}`);
      if (!classId) return;
      setOpenClassIds((prev) => (prev.has(classId) ? prev : new Set(prev).add(classId)));
      document.getElementById(`class-${classId}`)?.scrollIntoView({ block: "start" });
    }

    openFromHash();
    window.addEventListener("hashchange", openFromHash);
    return () => window.removeEventListener("hashchange", openFromHash);
  }, []);

  function toggleClass(cls: CoachClassView) {
    const isOpen = openClassIds.has(cls.classId);
    setOpenClassIds((prev) => {
      const next = new Set(prev);
      if (isOpen) next.delete(cls.classId);
      else next.add(cls.classId);
      return next;
    });
    if (isOpen && expanded && cls.sessions.some((s) => s.classSessionId === expanded.classSessionId)) {
      requestSeq.current += 1;
      setExpanded(null);
    }
  }

  async function toggleSession(classSessionId: string) {
    const seq = ++requestSeq.current;
    if (expanded?.classSessionId === classSessionId) {
      setExpanded(null);
      return;
    }
    setExpanded({ classSessionId, status: "loading", rows: [] });
    let result: Awaited<ReturnType<typeof getMySessionRosterAction>>;
    try {
      result = picker ? await getCoachSessionRosterAction(picker.coachId, classSessionId) : await getMySessionRosterAction(classSessionId);
    } catch {
      // A rejected call -- a network drop, or a stale action id after a
      // redeploy -- must still leave the loading state, or the spinner never
      // stops.
      if (seq === requestSeq.current) setExpanded({ classSessionId, status: "error", rows: [] });
      return;
    }
    if (seq !== requestSeq.current) return;
    const { data, error } = result;
    setExpanded(
      error || !data
        ? { classSessionId, status: "error", rows: [] }
        : { classSessionId, status: "ready", rows: data },
    );
  }

  const createButton = coach ? (
    <Button type="button" onClick={() => setModal({ open: true, editing: null })}>
      {t("classes.coach.create")}
    </Button>
  ) : null;

  // The dialogs and the toast sit at one fixed position (the last child), outside the empty/non-empty branches, so the refresh that follows a
  // Coach's first create swaps the list in without remounting them (the toast and the focus return survive).
  return (
    <div className="space-y-3">
      {classes.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-md border border-dashed py-16 text-center">
          <p className="text-sm text-muted-foreground">
            {picker
              ? t("coach.picker.noClasses", { name: picker.coachName })
              : coach
                ? t("classes.coach.empty")
                : t("coachPortal.classes.emptyNoClasses")}
          </p>
          {createButton}
        </div>
      ) : (
        <div className="space-y-3">
          {createButton && <div className="flex justify-end">{createButton}</div>}
          {classes.map((cls) => {
            const isOpen = openClassIds.has(cls.classId);
            const sessionsId = `class-${cls.classId}-sessions`;
            const editRow = coach && !cls.cancelledLabel ? cls.editRow : undefined;
            return (
              <section key={cls.classId} id={`class-${cls.classId}`} className="rounded-md border bg-card">
                <div className="flex items-center gap-2 pr-3">
                  <h2 className="min-w-0 flex-1 text-sm font-medium">
                    <button
                      type="button"
                      aria-expanded={isOpen}
                      aria-controls={sessionsId}
                      onClick={() => toggleClass(cls)}
                      className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 rounded-md p-4 text-left hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span aria-hidden="true" className="text-muted-foreground">
                        {isOpen ? "▾" : "▸"}
                      </span>
                      <span className="font-semibold">{cls.className}</span>
                      {cls.cancelledLabel && <Badge variant="secondary">{cls.cancelledLabel}</Badge>}
                      <span className="text-muted-foreground">{cls.scheduleLabel}</span>
                      <span className="ml-auto text-muted-foreground">{cls.capacityLabel}</span>
                    </button>
                  </h2>
                  {picker && (
                    <Link href="/classes" className="inline-flex shrink-0 items-center gap-1 text-sm text-primary hover:underline">
                      {t("coach.picker.openInClasses")}
                      <ArrowRight className="size-3.5" aria-hidden="true" />
                    </Link>
                  )}
                  {editRow && (
                    <div className="flex shrink-0 gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        ref={(el) => {
                          if (el) editButtonRefs.current.set(cls.classId, el);
                          else editButtonRefs.current.delete(cls.classId);
                        }}
                        onClick={() => setModal({ open: true, editing: editRow })}
                      >
                        {t("classes.edit")}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        ref={(el) => {
                          if (el) cancelButtonRefs.current.set(cls.classId, el);
                          else cancelButtonRefs.current.delete(cls.classId);
                        }}
                        onClick={() => setCancelling(editRow)}
                      >
                        {t("classes.cancel.action")}
                      </Button>
                    </div>
                  )}
                </div>

                <div id={sessionsId} hidden={!isOpen} className="border-t px-4 py-2">
                  {cls.sessions.length === 0 ? (
                    <p className="py-2 text-sm text-muted-foreground">{t("classes.noUpcomingSession")}</p>
                  ) : (
                    <ul className="divide-y">
                      {cls.sessions.map((session) => {
                        const isExpanded = expanded?.classSessionId === session.classSessionId;
                        const rosterId = `session-${session.classSessionId}-roster`;
                        return (
                          <li key={session.classSessionId}>
                            <button
                              type="button"
                              aria-expanded={isExpanded}
                              aria-controls={rosterId}
                              onClick={() => void toggleSession(session.classSessionId)}
                              className="flex w-full items-center gap-3 rounded-md py-2 text-left text-sm hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                              <span aria-hidden="true" className="text-muted-foreground">
                                {isExpanded ? "▾" : "▸"}
                              </span>
                              <span>{session.label}</span>
                              {session.oldTimeLabel && <Badge variant="outline">{session.oldTimeLabel}</Badge>}
                              <span className="ml-auto text-muted-foreground">{session.bookedLabel}</span>
                            </button>
                            <div id={rosterId} hidden={!isExpanded} className="pb-3 pl-6">
                              {isExpanded && expanded && <RosterPanel state={expanded} />}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}
      {coach && (
        <CoachClassDialogs
          coach={coach}
          gymTimezone={gymTimezone}
          modal={modal}
          setModal={setModal}
          cancelling={cancelling}
          setCancelling={setCancelling}
          editButtonRefs={editButtonRefs}
          cancelButtonRefs={cancelButtonRefs}
        />
      )}
    </div>
  );
}

/** Story 29.3: the modal, the Cancel class dialog and the toast of a Coach's own classes. A separate component so the read-only list (no `coach`)
 * never touches the router or a write action. */
function CoachClassDialogs({
  coach,
  gymTimezone,
  modal,
  setModal,
  cancelling,
  setCancelling,
  editButtonRefs,
  cancelButtonRefs,
}: {
  coach: CoachIdentity;
  gymTimezone: string | null;
  modal: { open: boolean; editing: ClassRow | null };
  setModal: (next: { open: boolean; editing: ClassRow | null }) => void;
  cancelling: ClassRow | null;
  setCancelling: (cls: ClassRow | null) => void;
  editButtonRefs: React.RefObject<Map<string, HTMLButtonElement>>;
  cancelButtonRefs: React.RefObject<Map<string, HTMLButtonElement>>;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  function showToast(message: string) {
    setToast(message);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 4000);
  }

  return (
    <>
      <ClassModal
        open={modal.open}
        onClose={() => setModal({ open: false, editing: modal.editing })}
        onSaved={(warning) => {
          const saved = modal.editing;
          setModal({ open: false, editing: modal.editing });
          if (warning) showToast(warning);
          router.refresh();
          if (saved) requestAnimationFrame(() => editButtonRefs.current.get(saved.id)?.focus());
        }}
        editingClass={modal.editing}
        coaches={[]}
        gymTimezone={gymTimezone}
        coachMode={coach}
        onOwnOnlyRefused={() => router.refresh()}
      />

      {cancelling && (
        <CancelClassDialog
          cls={cancelling}
          onClose={(opts) => {
            const target = cancelling;
            setCancelling(null);
            if (opts?.refresh) router.refresh();
            requestAnimationFrame(() =>
              (cancelButtonRefs.current.get(target.id) ?? editButtonRefs.current.get(target.id))?.focus(),
            );
          }}
          onDone={(name) => {
            setCancelling(null);
            showToast(t("classes.cancel.toast", { name }));
            router.refresh();
          }}
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
    </>
  );
}

function RosterPanel({ state }: { state: ExpandedSession }) {
  const { t } = useTranslation();

  if (state.status === "loading") {
    return (
      <div className="flex items-center gap-2 py-1 text-sm text-muted-foreground" aria-busy="true">
        <span className="size-4 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
        {t("classes.attendance.loadingBookings")}
      </div>
    );
  }

  if (state.status === "error") {
    return <p className="py-1 text-sm text-red-600">{t("common.loadError")}</p>;
  }

  if (state.rows.length === 0) {
    return <p className="py-1 text-sm text-muted-foreground">{t("classes.attendance.noBookings")}</p>;
  }

  return (
    <ul className="space-y-1">
      {state.rows.map((row) => (
        <li key={row.memberId} className="flex items-center justify-between gap-3 py-1 text-sm">
          <span className="truncate">{row.memberName}</span>
          {row.attendedAt !== null ? (
            <Badge variant="outline" className="shrink-0 border-green-200 bg-green-100 text-green-800">
              <CheckCircle2 className="mr-1 size-3" />
              {t("classes.attendance.attended")}
            </Badge>
          ) : (
            <span className="shrink-0 text-muted-foreground">
              <span aria-hidden="true">—</span>
              <span className="sr-only">{t("coachPortal.classes.notAttended")}</span>
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
