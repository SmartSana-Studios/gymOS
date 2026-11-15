"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, CheckCircle2, Clock, Info, Search, Ticket, WifiOff, X, XCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { SupportCodeField, goToLoginExpired, isSupportCodeWellFormed } from "@/components/support-code-field";
import { RenewalPanel } from "@/components/shared/RenewalModal";
import { RecordSessionPaymentPanel } from "@/components/shared/RecordSessionPaymentDialog";
import { CHECK_IN_SEARCH_LIMIT, isSearchTermLongEnough } from "@/lib/attendance-search";
import type { CheckInSearchRow, StaffCheckInResult } from "@/services/attendance";
import { searchMembersForCheckInAction, staffCheckInAction } from "../actions";
import { STATUS_BADGE_CONFIG, resolveBadgeStatus } from "../attendanceLabels";

const SEARCH_DEBOUNCE_MS = 300;

function subscribeOnline(onChange: () => void) {
  window.addEventListener("offline", onChange);
  window.addEventListener("online", onChange);
  return () => {
    window.removeEventListener("offline", onChange);
    window.removeEventListener("online", onChange);
  };
}

/** What the modal shows. Every result is the server's answer; the client never predicts it (AD-30). */
type View =
  | { kind: "search" }
  | { kind: "result"; member: CheckInSearchRow; result: StaffCheckInResult; panel: "renew" | "payment" | null }
  | { kind: "suspended"; member: CheckInSearchRow }
  /** R6: the check-in completed after a renewal or a desk payment. */
  | { kind: "completed"; member: CheckInSearchRow; by: "renewal" | "session"; at: string | null }
  /** R10: the payment or renewal stands, the check-in did not complete. Retrying repeats ONLY the check-in. */
  | { kind: "partial"; member: CheckInSearchRow; by: "renewal" | "session" };

type Tone = "success" | "warning" | "danger" | "info" | "neutral";

const TONE_CLASS: Record<Tone, string> = {
  success: "border-green-200 bg-green-50 text-green-900 dark:border-green-900 dark:bg-green-950 dark:text-green-100",
  warning: "border-orange-200 bg-orange-50 text-orange-900 dark:border-orange-900 dark:bg-orange-950 dark:text-orange-100",
  danger: "border-red-200 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-100",
  info: "border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-100",
  neutral: "border-gray-200 bg-gray-50 text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100",
};

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.slice(0, 1).toUpperCase())
    .join("");
}

function Avatar({ name, size = "size-8" }: { name: string; size?: string }) {
  return (
    <span aria-hidden="true" className={`flex ${size} shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold`}>
      {initialsOf(name)}
    </span>
  );
}

function ResultShell({
  member,
  tone,
  icon: IconComponent,
  label,
  live,
  children,
  actions,
}: {
  member: CheckInSearchRow;
  tone: Tone;
  icon: typeof CheckCircle2;
  label: string;
  live: "status" | "alert";
  children: React.ReactNode;
  actions: React.ReactNode;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Avatar name={member.name} size="size-10" />
        <span className="font-medium">{member.name}</span>
      </div>
      <div role={live} className={`space-y-2 rounded-md border p-4 text-sm ${TONE_CLASS[tone]}`}>
        <p className="flex items-center gap-2 font-semibold">
          <IconComponent size={16} aria-hidden="true" />
          {label}
        </p>
        {children}
      </div>
      {actions}
    </div>
  );
}

/**
 * Story 27.3, UX AD-30: the Check in a member modal. Step 1 finds and chooses a member; the confirm button names the person and is the
 * only confirmation. Step 2 is one result panel R1 to R12 with the server's answer. A renewal (R2, R3, R4) or a desk payment (R5) is made
 * IN PLACE through the shared panels, and the check-in then completes by itself (R6). If that second call fails, R10 retries only the
 * check-in: the payment function is never called a second time.
 *
 * A GymOS Support session types a fresh authenticator code before the check-in (single use, bound to the member). After a renewal or a
 * payment made by support the code is spent, so support lands on R10 and types a new code to complete (an owner-visible difference that
 * keeps the database contract unchanged).
 */
export function CheckInMemberModal({
  role,
  mobileMoneyEnabled,
  onClose,
  onChanged,
}: {
  role?: string;
  mobileMoneyEnabled: boolean;
  onClose: () => void;
  /** A check-in, renewal or payment changed what the page shows: refresh it. */
  onChanged: () => void;
}) {
  const { t, i18n } = useTranslation();
  const isSupport = role === "support";
  const dialogRef = useRef<HTMLDialogElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchSeqRef = useRef(0);
  const inFlightRef = useRef(false);

  const [view, setView] = useState<View>({ kind: "search" });
  const [term, setTerm] = useState("");
  const [rows, setRows] = useState<CheckInSearchRow[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [searchedTerm, setSearchedTerm] = useState("");
  const [retrySearch, setRetrySearch] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [authCode, setAuthCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [panelBusy, setPanelBusy] = useState(false);
  const [networkFailure, setNetworkFailure] = useState(false);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  // The browser's connection state is an external store; the server render assumes online.
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);

  const longEnough = isSearchTermLongEnough(term);
  const visibleRows = longEnough ? rows : [];
  const selected = visibleRows.find((row) => row.id === selectedId) ?? null;
  const busy = submitting || panelBusy;

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  // "Entry time: now (07:02)" updates each minute; the server stamps the real time.
  useEffect(() => {
    const handle = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(handle);
  }, []);

  // Step 1 focus: on open, and again whenever the modal returns to step 1.
  useEffect(() => {
    if (view.kind === "search") searchInputRef.current?.focus();
  }, [view.kind]);

  // Debounced search, 300 ms, as AD-03. A late answer for an older term is dropped.
  useEffect(() => {
    if (!isSearchTermLongEnough(term)) return;
    const seq = ++searchSeqRef.current;
    const handle = setTimeout(async () => {
      setSearching(true);
      setSearchError(false);
      try {
        const { data, error } = await searchMembersForCheckInAction(term);
        if (seq !== searchSeqRef.current) return;
        if (error || !data) {
          setSearchError(true);
          setRows([]);
          setHasMore(false);
        } else {
          setRows(data.rows);
          setHasMore(data.hasMore);
        }
        setSearchedTerm(term);
      } catch {
        if (seq === searchSeqRef.current) setSearchError(true);
      } finally {
        if (seq === searchSeqRef.current) setSearching(false);
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [term, retrySearch]);

  function timeLabel(iso: string | null | undefined): string {
    const date = iso ? new Date(iso) : new Date(nowMs);
    return date.toLocaleTimeString(i18n.language, { hour: "2-digit", minute: "2-digit", hour12: false });
  }

  function dateLabel(dateOnly: string | null | undefined): string {
    if (!dateOnly) return "";
    const [year, month, day] = dateOnly.split("-").map(Number);
    return new Date(year, month - 1, day).toLocaleDateString(i18n.language, { day: "numeric", month: "long", year: "numeric" });
  }

  function backToSearch() {
    setView({ kind: "search" });
    setTerm("");
    setRows([]);
    setHasMore(false);
    setSelectedId(null);
    setSearchedTerm("");
    setAuthCode("");
    setNetworkFailure(false);
    setInlineError(null);
  }

  /**
   * One call to staff_check_in. `origin` says where it was made from: the confirm button on step 1 (a network failure stays on step 1,
   * R11), or the automatic completion after a renewal or payment, or the R10 retry (a failure of any kind is R10).
   */
  async function runCheckIn(member: CheckInSearchRow, origin: "confirm" | { by: "renewal" | "session" }) {
    if (inFlightRef.current) return;
    if (isSupport && !isSupportCodeWellFormed(authCode)) {
      setInlineError(t("supportStepUp.codeRequired"));
      return;
    }
    inFlightRef.current = true;
    setSubmitting(true);
    setNetworkFailure(false);
    setInlineError(null);
    const by = origin === "confirm" ? null : origin.by;
    try {
      const { data, error } = await staffCheckInAction(isSupport ? { memberId: member.id, authCode } : { memberId: member.id });
      setAuthCode("");
      if (error || !data) {
        if (error?.code === "account_locked") {
          goToLoginExpired();
          return;
        }
        if (error?.code === "gym_suspended") {
          setView({ kind: "suspended", member });
          return;
        }
        if (by) {
          setView({ kind: "partial", member, by });
          return;
        }
        // A refused role, a failed step-up: say why and stay on step 1.
        setInlineError(error?.message ?? t("attendance.checkIn.network", { name: member.name }));
        return;
      }

      const outcome = data.outcome;
      const accepted = outcome === "checked_in" || outcome === "checked_in_expiring_soon" || outcome === "checked_in_grace_period";
      if (accepted) onChanged();
      if (by && accepted) {
        setView({ kind: "completed", member, by, at: data.checkedInAt });
        return;
      }
      if (by && outcome !== "already_checked_in") {
        // The payment or renewal stands but the check-in was not accepted (for example a refusal that appeared meanwhile).
        setView({ kind: "partial", member, by });
        return;
      }
      setView({ kind: "result", member, result: data, panel: null });
    } catch {
      setAuthCode("");
      if (by) setView({ kind: "partial", member, by });
      else setNetworkFailure(true);
    } finally {
      inFlightRef.current = false;
      setSubmitting(false);
    }
  }

  function completeAfter(member: CheckInSearchRow, by: "renewal" | "session") {
    onChanged();
    if (isSupport) {
      // The single-use grant is spent: support types a fresh code and completes through R10.
      setView({ kind: "partial", member, by });
      return;
    }
    void runCheckIn(member, { by });
  }

  // ---- step 1 ---------------------------------------------------------------------------------------------------------------------

  const entryTimeLine = t("attendance.checkIn.entryTime", { time: timeLabel(null) });

  function renderSearchStep() {
    const showNone = longEnough && !searching && !searchError && searchedTerm === term && visibleRows.length === 0;
    const confirmDisabled = !selected || submitting || !online || (isSupport && !isSupportCodeWellFormed(authCode));
    return (
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="checkInSearch">{t("attendance.checkIn.search.label")}</Label>
          <div className="relative">
            <Search size={14} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="checkInSearch"
              ref={searchInputRef}
              value={term}
              onChange={(e) => {
                setTerm(e.target.value);
                setNetworkFailure(false);
                setInlineError(null);
              }}
              autoComplete="off"
              aria-describedby="checkInSearchHint"
              className="pl-8"
              disabled={submitting}
            />
          </div>
          <p id="checkInSearchHint" className="text-xs text-muted-foreground">
            {t("attendance.checkIn.search.hint")}
          </p>
          {!online && (
            <p role="status" className="text-sm text-muted-foreground">
              <WifiOff size={14} aria-hidden="true" className="mr-1 inline" />
              {t("attendance.checkIn.offline")}
            </p>
          )}
        </div>

        <p className="sr-only" role="status" aria-live="polite">
          {longEnough && !searching && visibleRows.length > 0 ? t("attendance.checkIn.search.count", { count: visibleRows.length }) : ""}
        </p>

        {searching && (
          <div aria-hidden="true" className="space-y-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-12 animate-pulse rounded-md bg-muted" />
            ))}
          </div>
        )}

        {searchError && !searching && (
          <div role="alert" className="flex items-center justify-between gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900">
            <span>{t("attendance.checkIn.search.error")}</span>
            <Button type="button" variant="outline" size="sm" onClick={() => setRetrySearch((n) => n + 1)}>
              {t("attendance.checkIn.search.retry")}
            </Button>
          </div>
        )}

        {showNone && <p className="text-sm text-muted-foreground">{t("attendance.checkIn.search.none", { term })}</p>}

        {!searching && visibleRows.length > 0 && (
          <div role="radiogroup" aria-label={t("attendance.checkIn.search.results")} className="space-y-2">
            {visibleRows.map((row) => {
              const badgeKey = resolveBadgeStatus({ status: row.status ?? "no_active_plan", deactivatedAt: row.deactivatedAt });
              const badge = STATUS_BADGE_CONFIG[badgeKey];
              const Icon = badge.icon;
              const checked = row.id === selectedId;
              return (
                <label
                  key={row.id}
                  className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm ${checked ? "border-primary bg-accent" : ""}`}
                >
                  <input
                    type="radio"
                    name="checkInMember"
                    value={row.id}
                    checked={checked}
                    onChange={() => setSelectedId(row.id)}
                    disabled={submitting}
                    className="mt-2"
                  />
                  <Avatar name={row.name} />
                  <span className="min-w-0 flex-1 space-y-1">
                    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="font-medium">{row.name}</span>
                      <span className="text-muted-foreground">{row.phone ?? ""}</span>
                      <span className="text-muted-foreground">{row.planName ?? t("attendance.checkIn.row.noPlan")}</span>
                      <Badge variant="outline" className={badge.className}>
                        <Icon size={12} className="mr-1" />
                        {t(badge.labelKey)}
                      </Badge>
                    </span>
                    {row.insideSince && (
                      <span className="block text-xs text-muted-foreground">{t("attendance.checkIn.row.inside", { time: timeLabel(row.insideSince) })}</span>
                    )}
                  </span>
                </label>
              );
            })}
            {hasMore && visibleRows.length >= CHECK_IN_SEARCH_LIMIT && (
              <p className="text-xs text-muted-foreground">{t("attendance.checkIn.search.more")}</p>
            )}
          </div>
        )}

        <p className="text-sm text-muted-foreground">{entryTimeLine}</p>

        {isSupport && selected && (
          <div className="space-y-2">
            <p className="text-sm font-medium">{t("attendance.checkIn.supportAbout", { name: selected.name })}</p>
            <SupportCodeField id="checkInAuthCode" value={authCode} onChange={setAuthCode} disabled={submitting} />
          </div>
        )}

        {(networkFailure || inlineError) && selected && (
          <div role="alert" className="space-y-1 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900">
            <p>{networkFailure ? t("attendance.checkIn.network", { name: selected.name }) : inlineError}</p>
            {networkFailure && <p>{t("attendance.checkIn.networkHint", { name: selected.name })}</p>}
          </div>
        )}
        {inlineError && !selected && (
          <p role="alert" className="text-sm text-red-600">
            {inlineError}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
            {t("common.cancel")}
          </Button>
          <Button type="button" disabled={confirmDisabled} onClick={() => selected && void runCheckIn(selected, "confirm")}>
            {submitting ? t("attendance.checkIn.checkingIn") : selected ? t("attendance.checkIn.confirm", { name: selected.name }) : t("attendance.checkIn.action")}
          </Button>
        </div>
      </div>
    );
  }

  // ---- step 2: the result panels R1 to R10 -------------------------------------------------------------------------------------------

  function anotherAndDone(extra?: React.ReactNode) {
    return (
      <div className="flex flex-wrap justify-end gap-2 pt-2">
        {extra}
        <Button type="button" variant="outline" onClick={backToSearch}>
          {t("attendance.checkIn.another")}
        </Button>
        <Button type="button" onClick={onClose}>
          {t("attendance.checkIn.done")}
        </Button>
      </div>
    );
  }

  function renderResult(current: Extract<View, { kind: "result" }>) {
    const { member, result, panel } = current;
    const name = member.name;
    const at = timeLabel(result.checkedInAt);
    const setPanel = (next: "renew" | "payment" | null) => setView({ ...current, panel: next });
    const renewButton = (
      <Button type="button" variant="outline" onClick={() => setPanel("renew")} disabled={panel === "renew"}>
        {t("attendance.checkIn.renewNow")}
      </Button>
    );
    const panels = (
      <>
        {panel === "renew" && (
          <div className="rounded-md border">
            <RenewalPanel
              memberId={member.id}
              memberName={name}
              mobileMoneyEnabled={mobileMoneyEnabled}
              onClose={() => setPanel(null)}
              onRenewed={() => completeAfter(member, "renewal")}
              onBusyChange={setPanelBusy}
            />
          </div>
        )}
        {panel === "payment" && (
          <div className="rounded-md border">
            <RecordSessionPaymentPanel
              memberId={member.id}
              memberName={name}
              role={role}
              titleId="checkInSessionPaymentTitle"
              onClose={() => setPanel(null)}
              onRecorded={() => completeAfter(member, "session")}
              onBusyChange={setPanelBusy}
            />
          </div>
        )}
      </>
    );

    switch (result.outcome) {
      case "checked_in":
        return (
          <ResultShell member={member} tone="success" icon={CheckCircle2} label={t("attendance.checkIn.resultLabel.success")} live="status" actions={anotherAndDone()}>
            <p>{t("attendance.checkIn.ok", { name, time: at })}</p>
          </ResultShell>
        );
      case "checked_in_expiring_soon":
        return (
          <>
            <ResultShell member={member} tone="warning" icon={AlertTriangle} label={t("attendance.checkIn.resultLabel.warning")} live="status" actions={anotherAndDone(renewButton)}>
              <p>{t("attendance.checkIn.okExpiring", { name, time: at, date: dateLabel(result.expiryDate) })}</p>
            </ResultShell>
            {panels}
          </>
        );
      case "checked_in_grace_period":
        return (
          <>
            <ResultShell member={member} tone="warning" icon={AlertTriangle} label={t("attendance.checkIn.resultLabel.warning")} live="status" actions={anotherAndDone(renewButton)}>
              <p>
                {t("attendance.checkIn.okGrace", { name, time: at, date: dateLabel(result.expiryDate), graceDate: dateLabel(result.graceEndsOn) })}
              </p>
            </ResultShell>
            {panels}
          </>
        );
      case "rejected_expired": {
        const days = result.daysSinceExpiry ?? 0;
        const text =
          days <= 0
            ? t("attendance.checkIn.rejectedExpiredToday", { name })
            : days === 1
              ? t("attendance.checkIn.rejectedExpiredOne", { name })
              : t("attendance.checkIn.rejectedExpired", { name, days });
        return (
          <>
            <ResultShell member={member} tone="danger" icon={XCircle} label={t("attendance.checkIn.resultLabel.rejected")} live="alert" actions={anotherAndDone(renewButton)}>
              <p>{text}</p>
              <p>{t("attendance.checkIn.rejectedExpiredHelp")}</p>
            </ResultShell>
            {panels}
          </>
        );
      }
      case "session_required":
        return (
          <>
            <ResultShell
              member={member}
              tone="info"
              icon={Ticket}
              label={t("attendance.checkIn.resultLabel.payment")}
              live="alert"
              actions={anotherAndDone(
                <Button type="button" onClick={() => setPanel("payment")} disabled={panel === "payment"}>
                  {t("attendance.checkIn.recordAndCheckIn")}
                </Button>,
              )}
            >
              <p>{t("attendance.checkIn.sessionNeeded", { name })}</p>
              <p>{t("attendance.checkIn.sessionNeededHelp", { name, amount: (result.sessionAmount ?? 0).toLocaleString(i18n.language) })}</p>
            </ResultShell>
            {panels}
          </>
        );
      case "already_checked_in":
        return (
          <ResultShell member={member} tone="warning" icon={Clock} label={t("attendance.checkIn.resultLabel.already")} live="status" actions={anotherAndDone()}>
            <p>{t("attendance.checkIn.alreadyIn", { name, time: timeLabel(result.since) })}</p>
            <p>{t("attendance.checkIn.alreadyInHelp")}</p>
          </ResultShell>
        );
      case "refused_deactivated":
      case "refused_registration_fee_due":
      case "refused_no_plan":
      case "member_not_found": {
        const key =
          result.outcome === "refused_deactivated"
            ? "attendance.checkIn.refused.deactivated"
            : result.outcome === "refused_registration_fee_due"
              ? "attendance.checkIn.refused.awaitingFee"
              : result.outcome === "refused_no_plan"
                ? "attendance.checkIn.refused.noPlan"
                : "attendance.checkIn.refused.notFound";
        return (
          <ResultShell member={member} tone="neutral" icon={Info} label={t("attendance.checkIn.resultLabel.refused")} live="alert" actions={anotherAndDone()}>
            <p>{t(key, { name })}</p>
            {result.outcome !== "member_not_found" && (
              <p>
                <Link href={`/members?memberId=${member.id}`} className="underline">
                  {t("attendance.checkIn.openMember", { name })}
                </Link>
              </p>
            )}
          </ResultShell>
        );
      }
      default:
        return (
          <ResultShell member={member} tone="danger" icon={XCircle} label={t("attendance.checkIn.resultLabel.rejected")} live="alert" actions={anotherAndDone()}>
            <p>{t("attendance.checkIn.network", { name })}</p>
          </ResultShell>
        );
    }
  }

  function renderView() {
    switch (view.kind) {
      case "search":
        return renderSearchStep();
      case "result":
        return renderResult(view);
      case "suspended":
        return (
          <ResultShell
            member={view.member}
            tone="danger"
            icon={XCircle}
            label={t("attendance.checkIn.resultLabel.suspended")}
            live="alert"
            actions={
              <div className="flex justify-end pt-2">
                <Button type="button" onClick={onClose}>
                  {t("attendance.checkIn.done")}
                </Button>
              </div>
            }
          >
            <p>{t("attendance.checkIn.refused.suspendedGym")}</p>
          </ResultShell>
        );
      case "completed":
        return (
          <ResultShell member={view.member} tone="success" icon={CheckCircle2} label={t("attendance.checkIn.resultLabel.success")} live="status" actions={anotherAndDone()}>
            <p>
              {t(view.by === "renewal" ? "attendance.checkIn.renewedDone" : "attendance.checkIn.sessionDone", {
                name: view.member.name,
                time: timeLabel(view.at),
              })}
            </p>
          </ResultShell>
        );
      case "partial": {
        const member = view.member;
        const by = view.by;
        return (
          <ResultShell
            member={member}
            tone="warning"
            icon={AlertTriangle}
            label={t("attendance.checkIn.resultLabel.partial")}
            live="alert"
            actions={
              <div className="space-y-3">
                {isSupport && (
                  <div className="space-y-2">
                    <p className="text-sm font-medium">{t("attendance.checkIn.supportAbout", { name: member.name })}</p>
                    <SupportCodeField id="checkInRetryAuthCode" value={authCode} onChange={setAuthCode} disabled={submitting} />
                  </div>
                )}
                {inlineError && (
                  <p role="alert" className="text-sm text-red-600">
                    {inlineError}
                  </p>
                )}
                <div className="flex justify-end gap-2 pt-2">
                  <Button type="button" onClick={() => void runCheckIn(member, { by })} disabled={submitting || !online || (isSupport && !isSupportCodeWellFormed(authCode))}>
                    {submitting ? t("attendance.checkIn.checkingIn") : t("attendance.checkIn.confirm", { name: member.name })}
                  </Button>
                  <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
                    {t("attendance.checkIn.done")}
                  </Button>
                </div>
              </div>
            }
          >
            <p>{t(by === "session" ? "attendance.checkIn.partialSession" : "attendance.checkIn.partialRenewal", { name: member.name })}</p>
          </ResultShell>
        );
      }
    }
  }

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      onCancel={(e) => {
        if (busy) e.preventDefault();
      }}
      aria-labelledby="checkInTitle"
      className="w-full max-w-[560px] rounded-md border bg-background p-0 text-foreground backdrop:bg-black/50"
    >
      <div className="space-y-4 p-6">
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-1">
            <h2 id="checkInTitle" className="text-lg font-semibold">
              {t("attendance.checkIn.title")}
            </h2>
            {view.kind === "search" && <p className="text-sm text-muted-foreground">{t("attendance.checkIn.intro")}</p>}
          </div>
          <button
            type="button"
            aria-label={t("attendance.checkIn.close")}
            onClick={onClose}
            disabled={busy}
            className="text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            <X size={16} />
          </button>
        </div>
        {renderView()}
      </div>
    </dialog>
  );
}
