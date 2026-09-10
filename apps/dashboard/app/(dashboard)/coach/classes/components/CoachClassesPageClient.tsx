"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { CheckCircle2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { CoachRosterRow } from "@/services/classes";
import { getMySessionRosterAction } from "../actions";

/** One session row, every label already formatted on the server in the gym's
 * timezone (coach/classes/page.tsx). */
export interface CoachClassSessionView {
  classSessionId: string;
  label: string;
  bookedLabel: string;
}

export interface CoachClassView {
  classId: string;
  className: string;
  scheduleLabel: string;
  capacityLabel: string;
  sessions: CoachClassSessionView[];
}

type ExpandedSession = {
  classSessionId: string;
  status: "loading" | "error" | "ready";
  rows: CoachRosterRow[];
};

/**
 * Story 17.4 (AC #11): AD-21's class list. Read-only by construction -- the
 * only interactive elements are disclosure buttons; there is no write
 * control, link or form to hide, and no role prop to gate one on.
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
export function CoachClassesPageClient({ classes }: { classes: CoachClassView[] }) {
  const { t } = useTranslation();
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
      result = await getMySessionRosterAction(classSessionId);
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

  return (
    <div className="space-y-3">
      {classes.map((cls) => {
        const isOpen = openClassIds.has(cls.classId);
        const sessionsId = `class-${cls.classId}-sessions`;
        return (
          <section key={cls.classId} id={`class-${cls.classId}`} className="rounded-md border">
            <h2 className="text-sm font-medium">
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
                <span className="text-muted-foreground">{cls.scheduleLabel}</span>
                <span className="ml-auto text-muted-foreground">{cls.capacityLabel}</span>
              </button>
            </h2>

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
