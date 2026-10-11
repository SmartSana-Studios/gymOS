"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Info, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import type { FrontDeskAlertRow } from "@/services/frontDeskAlerts";
import { RenewalModal } from "@/components/shared/RenewalModal";
import { RecordSessionPaymentDialog } from "@/components/shared/RecordSessionPaymentDialog";
import { loadSessionAlertContext, type SessionAlertContext } from "@/lib/frontDeskSessionAlerts";
import {
  autoDismissFrontDeskAlert,
  dismissFrontDeskAlert,
  fetchActiveFrontDeskAlerts,
  resolveMemberDisplay,
  subscribeToFrontDeskAlerts,
  type FrontDeskAlertRealtimeRow,
} from "@/lib/realtime/frontDeskAlerts";

// Architecture's explicit polling degrade path (architecture.md lines 73,
// 142, 199): a retention-critical alert failing silently is worse than no
// alert -- if the Realtime channel ever drops after having connected once,
// this panel falls back to refetching on this interval until it resubscribes.
const POLL_INTERVAL_MS = 5000;

const STATUS_LABEL_KEY: Record<NonNullable<FrontDeskAlertRow["status"]>, string> = {
  expiring_soon: "members.status.expiringSoon",
  grace_period: "members.status.gracePeriod",
  expired: "members.status.expired",
};

// expiryDate ("YYYY-MM-DD") vs. today, both compared as UTC calendar days --
// avoids a local-timezone off-by-one (mirrors attendance.ts's own UTC
// date-boundary discipline, Scope Note #4 there). Positive: days until
// expiry (expiring_soon's usual case). Negative: days since expiry
// (grace_period/expired's usual case).
function daysUntilExpiry(expiryDate: string): number {
  const [year, month, day] = expiryDate.split("-").map(Number);
  const expiryUtc = Date.UTC(year, month - 1, day);
  const now = new Date();
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((expiryUtc - todayUtc) / 86_400_000);
}

/**
 * Story 4.6. Cross-Cutting Component (EXPERIENCE.md lines 1509-1538),
 * rendered on Overview (AD-02) and Attendance (AD-11). TanStack Query is the
 * source of truth for the rendered list; Supabase Realtime INSERT/UPDATE
 * events are merged into that same cache via `setQueryData` -- this is this
 * codebase's first use of both. Nothing renders when the active list is
 * empty (UX: "Panel invisible when alert count = 0 -- no empty state").
 */
export function FrontDeskAlertPanel({
  gymId,
  initialAlerts,
  autoDismissMinutes,
  mobileMoneyEnabled,
  role,
}: {
  gymId: string;
  initialAlerts: FrontDeskAlertRow[];
  autoDismissMinutes: number;
  /** Story 4.12 (AC #4): threaded straight through to `RenewalModal`, same
   * convention as `autoDismissMinutes` -- read from `TARAMONEY_INITIATION_ENABLED`
   * by each Server Component caller (`page.tsx`/`AttendancePageClient`'s own
   * `page.tsx`). */
  mobileMoneyEnabled: boolean;
  /** Story 19.9b: the signed-in staff role. Threaded to the Record Session
   * Payment panel (Bank Transfer is manager-and-above); a coach never sees
   * the record action. */
  role?: string;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const queryKey = ["frontDeskAlerts", gymId];

  const { data: alerts } = useQuery({
    queryKey,
    initialData: initialAlerts,
    // Realtime (below) is the primary delivery path, merging events directly
    // into this same cache entry -- this queryFn only actually runs when the
    // polling degrade path calls invalidateQueries.
    queryFn: () => fetchActiveFrontDeskAlerts(gymId),
    staleTime: Infinity,
  });

  // Story 4.7: which single alert (if any) has its RenewalModal open -- only
  // one open at a time; clicking a different alert's [Renew] while one is
  // already open replaces it. Holds a snapshot of the alert row itself
  // (captured at click time), not just its id -- review finding: looking
  // this back up via `visibleAlerts.find()` on every render meant the modal
  // silently vanished, discarding whatever the receptionist had typed, if
  // the alert was dismissed/removed elsewhere (another session, or this
  // panel's own auto-dismiss timer) while still open. confirm_renewal()
  // doesn't depend on the alert row, and dismissFrontDeskAlert's own
  // `.is("dismissed_at", null)` guard already makes a dismiss-of-a-
  // already-gone alert a harmless no-op, so holding a stale snapshot open is
  // safe.
  const [openRenewalAlert, setOpenRenewalAlert] = useState<FrontDeskAlertRow | null>(null);
  // Review finding (Story 4.12): a stable identity for `onRenewed` --
  // RenewalModal's mobile-money pending-payment watch effect lists this
  // callback as a dependency, and this panel re-renders on every unrelated
  // Realtime alert INSERT/UPDATE and query cache write, so a fresh inline
  // arrow here would tear down/recreate the payment-status subscription
  // continuously while a payment is pending.
  const handleRenewed = useCallback(() => setOpenRenewalAlert(null), []);

  // Story 19.9b: the session-required alert whose Record Session Payment panel
  // is open -- a snapshot, same reasoning as openRenewalAlert above.
  const [openSessionAlert, setOpenSessionAlert] = useState<FrontDeskAlertRow | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);
  const canRecordSession = role !== "coach";

  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Review finding (Story 4.6): guards against an INSERT event's async
  // resolveMemberDisplay lookup resurrecting an alert that a later-arriving
  // UPDATE(dismiss) event already removed from the cache while that lookup
  // was still pending.
  const dismissedWhilePendingRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    function stopPolling() {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    }

    function startPolling() {
      if (pollIntervalRef.current) return;
      pollIntervalRef.current = setInterval(() => {
        queryClient.invalidateQueries({ queryKey });
      }, POLL_INTERVAL_MS);
    }

    async function handleInsertOrUpdate(row: FrontDeskAlertRealtimeRow) {
      if (row.dismissed_at) {
        dismissedWhilePendingRef.current.add(row.id);
        queryClient.setQueryData<FrontDeskAlertRow[]>(queryKey, (current) =>
          (current ?? []).filter((alert) => alert.id !== row.id),
        );
        return;
      }

      const alreadyKnown = (queryClient.getQueryData<FrontDeskAlertRow[]>(queryKey) ?? []).some(
        (alert) => alert.id === row.id,
      );
      if (alreadyKnown) return;

      const { data: member } = await resolveMemberDisplay(row.member_id);

      // The alert may have been dismissed by another session while this
      // lookup was in flight -- don't resurrect it.
      if (dismissedWhilePendingRef.current.has(row.id)) return;

      const isSession = row.kind === "session_required";
      // Story 19.9b: the session variant also needs the class, offline and
      // in-flight lines; a failed read just leaves them out.
      let sessionContext: SessionAlertContext | undefined;
      if (isSession) {
        try {
          sessionContext = (await loadSessionAlertContext(createClient(), gymId, [row.member_id])).get(row.member_id);
        } catch {
          sessionContext = undefined;
        }
        if (dismissedWhilePendingRef.current.has(row.id)) return;
      }

      const newAlert: FrontDeskAlertRow = {
        id: row.id,
        memberId: row.member_id,
        memberName: member?.name ?? "",
        memberPhotoUrl: member?.photoUrl ?? null,
        kind: isSession ? "session_required" : "subscription_status",
        status: row.status,
        expiryDate: row.expiry_date,
        createdAt: row.created_at,
        ...(isSession
          ? {
              className: sessionContext?.className ?? null,
              scannedOfflineAt: sessionContext?.scannedOfflineAt ?? null,
              paymentInFlight: sessionContext?.paymentInFlight ?? false,
            }
          : {}),
      };

      // New INSERT prepends -- newest alert at the top (UX behaviour rule).
      queryClient.setQueryData<FrontDeskAlertRow[]>(queryKey, (current) => [
        newAlert,
        ...(current ?? []).filter((alert) => alert.id !== newAlert.id),
      ]);
    }

    // Review finding (Story 4.6): poll on every non-SUBSCRIBED status, not
    // just after having reached SUBSCRIBED once -- if the channel fails on
    // its very first connection attempt (CHANNEL_ERROR/TIMED_OUT with no
    // prior SUBSCRIBED), the previous "only degrade after subscribing once"
    // gate meant polling never started at all and the panel stayed frozen
    // on stale initial data indefinitely.
    function handleStatusChange(status: string) {
      if (status === "SUBSCRIBED") {
        stopPolling();
        return;
      }
      startPolling();
    }

    const channel = subscribeToFrontDeskAlerts(gymId, handleInsertOrUpdate, handleStatusChange, {
      includeSessionRequired: true,
    });
    const supabase = createClient();

    return () => {
      stopPolling();
      // supabase.removeChannel (not channel.unsubscribe()) -- deregisters
      // the channel from the client's own registry too, matching Task 8's
      // explicit cleanup contract. createClient() returns the same
      // singleton browser client that created the channel (@supabase/ssr's
      // createBrowserClient caches one instance per browser tab).
      void supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gymId]);

  // Per-alert client-side auto-dismiss (default 30 min, gym-configured) --
  // there is no "system" user row to attribute a server-side scheduled
  // auto-dismiss to (Scope Notes), so every open session with this panel
  // mounted schedules its own timer per visible alert. Harmless if multiple
  // sessions' timers all fire for the same alert -- autoDismissFrontDeskAlert's
  // `.is("dismissed_at", null)` guard makes every fire after the first a
  // no-op.
  useEffect(() => {
    const timers = (alerts ?? []).map((alert) => {
      const elapsedMs = Date.now() - new Date(alert.createdAt).getTime();
      const remainingMs = autoDismissMinutes * 60_000 - elapsedMs;
      return setTimeout(() => {
        void autoDismissFrontDeskAlert(alert.id);
      }, Math.max(0, remainingMs));
    });

    return () => {
      timers.forEach(clearTimeout);
    };
  }, [alerts, autoDismissMinutes]);

  async function handleDismiss(alertId: string) {
    // Optimistic removal for this session's own click -- the UPDATE row's
    // own Realtime broadcast (delivered to every open session, including
    // this one) removes it too, but this session's own click shouldn't wait
    // on that round trip.
    const previousAlerts = queryClient.getQueryData<FrontDeskAlertRow[]>(queryKey) ?? [];
    const dismissedAlert = previousAlerts.find((alert) => alert.id === alertId);
    queryClient.setQueryData<FrontDeskAlertRow[]>(queryKey, (current) =>
      (current ?? []).filter((alert) => alert.id !== alertId),
    );

    // Review finding (Story 4.6): a failed dismiss (RLS denial, network
    // error) previously left the alert permanently gone from this
    // session's UI even though the DB write never happened. Roll the
    // optimistic removal back on error.
    const { error } = await dismissFrontDeskAlert(alertId);
    if (error && dismissedAlert) {
      queryClient.setQueryData<FrontDeskAlertRow[]>(queryKey, (current) =>
        (current ?? []).some((alert) => alert.id === alertId) ? current : [...(current ?? []), dismissedAlert],
      );
    }
  }

  const visibleAlerts = alerts ?? [];

  // The list region renders only while there is an alert (UX: invisible at
  // zero). The open modals and the toast live outside it so they survive the
  // last alert being removed -- recording the final session payment empties
  // the list at the same moment its toast must appear.
  return (
    <>
      {visibleAlerts.length > 0 && (
        <div
          className="max-h-[320px] space-y-2 overflow-y-auto rounded-md border p-2"
          role="region"
          aria-label={t("frontDeskAlert.panelLabel")}
        >
          {visibleAlerts.map((alert) => (
            <FrontDeskAlertItem
              key={alert.id}
              alert={alert}
              onDismiss={() => handleDismiss(alert.id)}
              onRenew={() => setOpenRenewalAlert(alert)}
              onRecordSession={canRecordSession ? () => setOpenSessionAlert(alert) : undefined}
            />
          ))}
        </div>
      )}
      {openRenewalAlert && (
        <RenewalModal
          alertId={openRenewalAlert.id}
          memberId={openRenewalAlert.memberId}
          memberName={openRenewalAlert.memberName || t("frontDeskAlert.unknownMember")}
          mobileMoneyEnabled={mobileMoneyEnabled}
          onClose={() => setOpenRenewalAlert(null)}
          onRenewed={handleRenewed}
        />
      )}
      {openSessionAlert && (
        <RecordSessionPaymentDialog
          alertId={openSessionAlert.id}
          memberId={openSessionAlert.memberId}
          memberName={openSessionAlert.memberName || t("frontDeskAlert.unknownMember")}
          role={role}
          onClose={() => setOpenSessionAlert(null)}
          onRecorded={() => {
            const alert = openSessionAlert;
            setOpenSessionAlert(null);
            // The alert is dismissed server-side by the dialog; remove it
            // here without waiting for the Realtime round trip.
            queryClient.setQueryData<FrontDeskAlertRow[]>(queryKey, (current) =>
              (current ?? []).filter((item) => item.id !== alert.id),
            );
            setToast(
              t("sessionPayment.recordedToast", {
                name: alert.memberName || t("frontDeskAlert.unknownMember"),
              }),
            );
            if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
            toastTimerRef.current = setTimeout(() => setToast(null), 4000);
          }}
        />
      )}
      {toast && (
        <div
          role="status"
          className="fixed bottom-4 right-4 z-50 max-w-sm rounded-md bg-primary px-4 py-3 text-sm text-primary-foreground shadow-lg"
        >
          {toast}
        </div>
      )}
    </>
  );
}

function FrontDeskAlertItem({
  alert,
  onDismiss,
  onRenew,
  onRecordSession,
}: {
  alert: FrontDeskAlertRow;
  onDismiss: () => void;
  onRenew: () => void;
  /** Absent for a role that cannot record a session payment (coach). */
  onRecordSession?: () => void;
}) {
  const { t, i18n } = useTranslation();
  if (alert.kind === "session_required") {
    return (
      <SessionRequiredAlertItem
        alert={alert}
        locale={i18n.language}
        onDismiss={onDismiss}
        onRecordSession={onRecordSession}
      />
    );
  }
  const isDenied = alert.status === "expired";
  const displayName = alert.memberName || t("frontDeskAlert.unknownMember");

  let daysLine: string | null = null;
  if (alert.expiryDate) {
    const diff = daysUntilExpiry(alert.expiryDate);
    daysLine =
      diff >= 0
        ? t("frontDeskAlert.expiresIn", { count: diff })
        : t("frontDeskAlert.expiredDaysAgo", { count: Math.abs(diff) });
  }

  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-md border p-3",
        isDenied ? "border-red-200 bg-red-50" : "border-yellow-200 bg-yellow-50",
      )}
      role="alert"
      aria-live={isDenied ? "assertive" : "polite"}
    >
      {alert.memberPhotoUrl ? (
        // Story 4.6: the first rendered member photo anywhere in this
        // dashboard -- no <Avatar> component exists yet (Scope Notes).
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={alert.memberPhotoUrl}
          alt=""
          className="size-10 shrink-0 rounded-full object-cover"
        />
      ) : (
        <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold">
          {displayName.slice(0, 1).toUpperCase()}
        </div>
      )}

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 text-sm">
          <span className="font-medium">{displayName}</span>
          <span className="text-muted-foreground">·</span>
          <span>{alert.status ? t(STATUS_LABEL_KEY[alert.status]) : ""}</span>
          {daysLine && (
            <>
              <span className="text-muted-foreground">·</span>
              <span>{daysLine}</span>
            </>
          )}
        </div>
        {isDenied && <p className="text-sm text-red-700">{t("frontDeskAlert.deniedMessage")}</p>}
      </div>

      <Button type="button" variant="outline" size="sm" onClick={onRenew}>
        {t("frontDeskAlert.renew")}
      </Button>

      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={t("frontDeskAlert.dismiss")}
        onClick={onDismiss}
      >
        <X size={16} />
      </Button>
    </div>
  );
}

/**
 * Story 19.9b: the session-required variant of the same alert item. A
 * recoverable action-required state, so the platform `info` treatment (blue,
 * label and icon, never danger) and an assertive live region: the front desk
 * has a guest waiting.
 */
function SessionRequiredAlertItem({
  alert,
  locale,
  onDismiss,
  onRecordSession,
}: {
  alert: FrontDeskAlertRow;
  locale: string;
  onDismiss: () => void;
  onRecordSession?: () => void;
}) {
  const { t } = useTranslation();
  const displayName = alert.memberName || t("frontDeskAlert.unknownMember");
  const time = (iso: string) =>
    new Date(iso).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });

  return (
    <div
      className="flex items-center gap-3 rounded-md border border-blue-200 border-l-4 border-l-blue-600 bg-blue-50 p-3"
      role="alert"
      aria-live="assertive"
    >
      <Info className="size-5 shrink-0 text-blue-700" aria-hidden="true" />

      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="text-xs font-semibold tracking-wide text-blue-800">{t("frontDeskAlert.sessionRequired")}</p>
        <div className="flex flex-wrap items-center gap-x-2 text-sm">
          <span className="font-medium">{displayName}</span>
          <span className="text-muted-foreground">·</span>
          <span>{t("frontDeskAlert.sessionNoPaidSession")}</span>
          <span className="text-muted-foreground">·</span>
          <span>{time(alert.createdAt)}</span>
        </div>
        <p className="text-sm text-blue-900">{t("frontDeskAlert.sessionRecordHint")}</p>
        {alert.className && (
          <p className="text-sm text-blue-900">{t("frontDeskAlert.sessionFromClass", { name: alert.className })}</p>
        )}
        {alert.scannedOfflineAt && (
          <p className="text-sm text-blue-900">
            {t("frontDeskAlert.sessionScannedOffline", { time: time(alert.scannedOfflineAt) })}
          </p>
        )}
        {alert.paymentInFlight && (
          <p className="text-sm font-medium text-blue-900">{t("frontDeskAlert.sessionPaymentInProgress")}</p>
        )}
      </div>

      {onRecordSession && (
        <Button type="button" variant="outline" size="sm" onClick={onRecordSession}>
          {t("frontDeskAlert.recordSessionPayment")}
        </Button>
      )}

      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={t("frontDeskAlert.dismiss")}
        onClick={onDismiss}
      >
        <X size={16} />
      </Button>
    </div>
  );
}
