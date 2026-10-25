"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import {
  GUEST_SESSIONS_PERIODS,
  guestSessionsHref,
  parseGuestSessionsPeriod,
  type GuestSessionsPeriod,
  type GuestSessionsSummary,
  type GuestSessionsTab,
} from "@/lib/guest-sessions";
import { getGuestSessionsSummaryAction } from "../actions";

export const GUEST_SESSIONS_PERIOD_STORAGE_KEY = "gymos.guestSessions.period";

function readStoredPeriod(): GuestSessionsPeriod {
  try {
    return parseGuestSessionsPeriod(window.localStorage.getItem(GUEST_SESSIONS_PERIOD_STORAGE_KEY));
  } catch {
    return "today";
  }
}

function storePeriod(period: GuestSessionsPeriod) {
  try {
    window.localStorage.setItem(GUEST_SESSIONS_PERIOD_STORAGE_KEY, period);
  } catch {
    // Private mode or blocked storage: the choice just is not remembered.
  }
}

/**
 * Story 19.10 (FR-163): the Overview's full-width Guest sessions card. The
 * server section hands in today's figures; the period control, its
 * localStorage memory and Retry live here, and a failure stays inside the
 * card. Each figure links to the AD-22 page for the same period and tab, whose
 * totals come from the same RPC aggregates.
 */
export function GuestSessionsCard({
  initialSummary,
  initialFailed,
}: {
  initialSummary: GuestSessionsSummary | null;
  initialFailed: boolean;
}) {
  const { t, i18n } = useTranslation();
  const [period, setPeriod] = useState<GuestSessionsPeriod>("today");
  const [summary, setSummary] = useState<GuestSessionsSummary | null>(initialSummary);
  const [failed, setFailed] = useState(initialFailed);
  const [loading, setLoading] = useState(false);
  // Only the latest request may write state (a quick Today -> Month -> Today).
  const requestRef = useRef(0);
  const radioRefs = useRef<Array<HTMLButtonElement | null>>([]);

  // Overview auto-refresh re-renders the server section with fresh figures for
  // today; adopt them while Today is showing. A fetched Month view is left alone.
  const [seenProps, setSeenProps] = useState({ initialSummary, initialFailed });
  if (seenProps.initialSummary !== initialSummary || seenProps.initialFailed !== initialFailed) {
    setSeenProps({ initialSummary, initialFailed });
    if (period === "today") {
      setSummary(initialSummary);
      setFailed(initialFailed);
    }
  }

  const load = useCallback(async (next: GuestSessionsPeriod) => {
    const requestId = ++requestRef.current;
    setLoading(true);
    setFailed(false);
    try {
      const { data, error } = await getGuestSessionsSummaryAction(next);
      if (requestId !== requestRef.current) return;
      if (error || !data) {
        console.error("GuestSessionsCard: summary failed", error);
        setSummary(null);
        setFailed(true);
      } else {
        setSummary(data);
      }
    } catch (error) {
      if (requestId !== requestRef.current) return;
      console.error("GuestSessionsCard: summary failed", error);
      setSummary(null);
      setFailed(true);
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  }, []);

  // The remembered period is a client-only fact, so it is applied after mount.
  // The server rendered today's figures; only a different stored period refetches.
  useEffect(() => {
    const stored = readStoredPeriod();
    if (stored !== "today") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPeriod(stored);
      void load(stored);
    }
  }, [load]);

  // Radiogroup keyboard pattern: arrows move selection and focus (roving tabindex).
  function onRadioKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    const step =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? -1
          : 0;
    if (step === 0) return;
    event.preventDefault();
    const count = GUEST_SESSIONS_PERIODS.length;
    const nextIndex = (index + step + count) % count;
    choose(GUEST_SESSIONS_PERIODS[nextIndex]);
    radioRefs.current[nextIndex]?.focus();
  }

  function choose(next: GuestSessionsPeriod) {
    if (next === period) return;
    setPeriod(next);
    storePeriod(next);
    void load(next);
  }

  const periodPhrase = t(period === "today" ? "overview.cards.guestSessionsCard.periodToday" : "overview.cards.guestSessionsCard.periodMonth");
  const format = (n: number) => n.toLocaleString(i18n.language);

  function figure(tab: GuestSessionsTab, label: string, value: number, aria: string, sub?: string) {
    return (
      <Link
        key={tab}
        href={guestSessionsHref(tab, period)}
        aria-label={aria}
        className="block rounded-md border p-4 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="text-2xl font-semibold">{format(value)}</p>
        {sub && <p className="mt-1 text-sm text-muted-foreground">{sub}</p>}
      </Link>
    );
  }

  return (
    <section className="rounded-md border p-4 bg-card" aria-labelledby="guestSessionsCardTitle">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="guestSessionsCardTitle" className="text-lg font-semibold">
          {t("overview.cards.guestSessionsCard.title")}
        </h2>
        <div
          role="radiogroup"
          aria-label={t("overview.cards.guestSessionsCard.period")}
          className="inline-flex rounded-md bg-muted p-1"
        >
          {GUEST_SESSIONS_PERIODS.map((p, index) => (
            <button
              key={p}
              ref={(el) => {
                radioRefs.current[index] = el;
              }}
              tabIndex={period === p ? 0 : -1}
              onKeyDown={(event) => onRadioKeyDown(event, index)}
              type="button"
              role="radio"
              aria-checked={period === p}
              onClick={() => choose(p)}
              className={`rounded-sm px-3 py-1 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                period === p ? "bg-background text-foreground shadow" : "text-muted-foreground"
              }`}
            >
              {t(`overview.cards.guestSessionsCard.${p === "today" ? "today" : "month"}`)}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4" aria-busy={loading}>
        {loading ? (
          <div className="h-[86px] w-full animate-pulse rounded-md bg-muted" data-testid="guest-sessions-card-loading" />
        ) : failed || !summary ? (
          <div role="alert" className="flex flex-wrap items-center gap-3 text-sm">
            <span>{t("overview.cards.guestSessionsCard.loadError")}</span>
            <Button variant="outline" size="sm" onClick={() => void load(period)}>
              {t("overview.cards.guestSessionsCard.retry")}
            </Button>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-3">
            {figure(
              "paid",
              t("overview.cards.guestSessionsCard.paid"),
              summary.paid,
              t("overview.cards.guestSessionsCard.paidAria", { period: periodPhrase, count: summary.paid }),
            )}
            {figure(
              "blocked",
              t("overview.cards.guestSessionsCard.blocked"),
              summary.blocked,
              t("overview.cards.guestSessionsCard.blockedAria", {
                period: periodPhrase,
                count: summary.blocked,
                members: summary.blockedMembers,
              }),
              t("overview.cards.guestSessionsCard.blockedMembers", { count: summary.blockedMembers }),
            )}
            {figure(
              "free",
              t("overview.cards.guestSessionsCard.free"),
              summary.free,
              t("overview.cards.guestSessionsCard.freeAria", { period: periodPhrase, count: summary.free }),
            )}
          </div>
        )}
      </div>
    </section>
  );
}
