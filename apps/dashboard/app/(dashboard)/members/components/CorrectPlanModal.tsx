"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { Info, X } from "lucide-react";
import { CORRECT_PLAN_REASON_MAX_LENGTH, CORRECT_PLAN_REASON_MIN_LENGTH } from "@gymos/types";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { SupportCodeField, goToLoginExpired, isSupportCodeWellFormed } from "@/components/support-code-field";
import { formatDayMonth, formatDayMonthYear, parseCalendarDate } from "@/lib/dayMonth";
import { planNameWithSummary, planOptionLabel } from "@/lib/planSummary";
import type { MemberListRow } from "@/services/members";
import type { PlanRow } from "@/services/plans";
import type { CorrectPlanEligibility, CorrectPlanRefusal, StandingBlock } from "@/services/members.correctPlan";
import { PAYMENT_METHOD_LABEL_KEY } from "@/app/(dashboard)/payments/paymentLabels";
import { correctPlanAction, getCorrectPlanEligibilityAction } from "../actions";

/** What a successful correction tells the page, for the toast and the in-place refresh (UX AD-31 success state). */
export interface CorrectedPlanResult {
  planName: string;
  planType: string;
  expiryDate: string | null;
  status: string;
}

/** The states that replace the form: neutral border, info icon, no red (the staff member did nothing wrong), `role="alert"`. */
type RefusalView =
  | { kind: "blocked"; block: StandingBlock }
  | { kind: "sessionHeld"; lapsesOn: string | null }
  | { kind: "noSubscription" }
  | { kind: "changed" }
  | { kind: "permission" };

type Phase =
  | { kind: "loading" }
  | { kind: "loadError" }
  | { kind: "ready"; eligibility: CorrectPlanEligibility }
  | { kind: "refusal"; view: RefusalView };

const selectClassName =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

/**
 * Story 27.4, UX AD-31: Correct plan. Fixes a plan chosen by mistake on a member's current subscription: a correction, not a renewal.
 * On open the modal asks `correct_plan_eligibility` and shows a skeleton and "Checking payments…"; a payment that still stands replaces
 * the form straight away (F1 to F5) so nobody types a reason for an action that cannot happen. The server check on submit is
 * authoritative: a refusal that was not there at open renders the matching F state. There is no preview of the new expiry (owner decision
 * 2026-11-15): the rule line states it and the success toast shows the result. Escape closes the modal; an unsaved reason is lost.
 */
export function CorrectPlanModal({
  member,
  plans,
  isSupport = false,
  onClose,
  onCorrected,
}: {
  member: MemberListRow;
  /** This gym's plans; the member's current plan is left out of the select. */
  plans: PlanRow[];
  /** A GymOS Support session types a fresh authenticator code; staff roles see no change. */
  isSupport?: boolean;
  onClose: () => void;
  /** The correction succeeded: the page closes the modal, refreshes, shows the toast and returns focus. */
  onCorrected: (result: CorrectedPlanResult) => void;
}) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inFlightRef = useRef(false);
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [planId, setPlanId] = useState("");
  const [reason, setReason] = useState("");
  const [authCode, setAuthCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [planError, setPlanError] = useState<"same" | "gone" | null>(null);
  const [reasonError, setReasonError] = useState(false);
  const [networkError, setNetworkError] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [gonePlanIds, setGonePlanIds] = useState<string[]>([]);

  const locale = i18n.language;

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  const load = useCallback(async () => {
    setPhase({ kind: "loading" });
    try {
      const { data, error } = await getCorrectPlanEligibilityAction({ memberId: member.id });
      if (error) {
        setPhase({ kind: "loadError" });
        return;
      }
      if (!data) {
        setPhase({ kind: "refusal", view: { kind: "noSubscription" } });
        return;
      }
      setPhase(data.block ? { kind: "refusal", view: { kind: "blocked", block: data.block } } : { kind: "ready", eligibility: data });
    } catch {
      setPhase({ kind: "loadError" });
    }
  }, [member.id]);

  useEffect(() => {
    // The opening check is this modal's own load; the state it sets is what the skeleton exists for.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  function money(amount: number): string {
    return amount.toLocaleString(locale);
  }

  function shortDate(value: string | null, on: string | null): string {
    const source = on ?? value;
    if (!source) return "";
    return formatDayMonth(on ? parseCalendarDate(on) : new Date(source), locale);
  }

  function longDate(dateOnly: string): string {
    return formatDayMonthYear(dateOnly, locale);
  }

  function methodLabel(method: string): string {
    const key = PAYMENT_METHOD_LABEL_KEY[method];
    return key ? t(key) : method;
  }

  /** F1 to F5 text: the lead, the one sentence for the state of the most recent standing payment, and the "+ N more" line. */
  function blockedLines(block: StandingBlock): string[] {
    const params = {
      amount: money(block.amount),
      date: shortDate(block.createdAt, block.on),
      method: methodLabel(block.method),
      refunded: money(block.refundedAmount),
    };
    const key =
      block.state === "verified"
        ? "members.correctPlan.blocked.verified"
        : block.state === "in_flight"
          ? "members.correctPlan.blocked.inFlight"
          : block.state === "partly_refunded"
            ? "members.correctPlan.blocked.partlyRefunded"
            : "members.correctPlan.blocked.pending";
    const lines = [`${t("members.correctPlan.blocked.lead")} ${t(key, params)}`];
    if (block.more > 0) lines.push(t("members.correctPlan.blocked.more", { count: block.more }));
    return lines;
  }

  function showRefusal(refusal: CorrectPlanRefusal) {
    switch (refusal.code) {
      case "payment_stands":
        setPhase({ kind: "refusal", view: { kind: "blocked", block: refusal.block } });
        return;
      case "session_held":
        setPhase({ kind: "refusal", view: { kind: "sessionHeld", lapsesOn: refusal.lapsesOn } });
        return;
      case "no_current_subscription":
        setPhase({ kind: "refusal", view: { kind: "noSubscription" } });
        return;
      case "subscription_changed":
        setPhase({ kind: "refusal", view: { kind: "changed" } });
        return;
      case "same_plan":
        setPlanError("same");
        return;
      case "plan_not_found":
        // F9: back to the form with the select refreshed: the chosen plan leaves the options now, the page re-reads the gym's plans.
        setGonePlanIds((ids) => (planId ? [...ids, planId] : ids));
        setPlanId("");
        setPlanError("gone");
        router.refresh();
        return;
      case "invalid_reason":
        setReasonError(true);
        return;
    }
  }

  const eligibility = phase.kind === "ready" ? phase.eligibility : null;
  const trimmedLength = reason.trim().length;
  const reasonValid = trimmedLength >= CORRECT_PLAN_REASON_MIN_LENGTH && trimmedLength <= CORRECT_PLAN_REASON_MAX_LENGTH;
  const codeValid = !isSupport || isSupportCodeWellFormed(authCode);
  const options = eligibility ? plans.filter((p) => p.id !== eligibility.subscription.planId && !gonePlanIds.includes(p.id)) : [];
  const canSubmit = Boolean(eligibility) && planId !== "" && reasonValid && codeValid && !submitting;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (inFlightRef.current || !eligibility) return;
    setNetworkError(false);
    setActionError(null);
    setPlanError(null);
    setReasonError(false);
    if (!reasonValid || planId === "") return;
    if (!codeValid) {
      setActionError(t("supportStepUp.codeRequired"));
      return;
    }
    inFlightRef.current = true;
    setSubmitting(true);
    try {
      const input = {
        memberId: member.id,
        newPlanId: planId,
        subscriptionId: eligibility.subscription.subscriptionId,
        reason: reason.trim(),
      };
      const result = await correctPlanAction(isSupport ? { ...input, authCode } : input);
      setAuthCode("");
      if (result.data) {
        onCorrected({
          planName: result.data.planName,
          planType: result.data.planType,
          expiryDate: result.data.expiryDate,
          status: result.data.status,
        });
        return;
      }
      if (result.permissionDenied) {
        setPhase({ kind: "refusal", view: { kind: "permission" } });
        return;
      }
      if (result.refusal) {
        showRefusal(result.refusal);
        return;
      }
      if (result.error?.code === "account_locked") {
        goToLoginExpired();
        return;
      }
      if (result.error && ["code_required", "invalid_code", "step_up_unavailable"].includes(result.error.code)) {
        setActionError(result.error.message);
        return;
      }
      // F11: a network or unexpected failure. The modal stays on the form and [Correct plan] stays enabled.
      setNetworkError(true);
    } catch {
      setAuthCode("");
      setNetworkError(true);
    } finally {
      inFlightRef.current = false;
      setSubmitting(false);
    }
  }

  const paymentsHref = (purpose: "subscription" | "session") =>
    `/payments?memberId=${encodeURIComponent(member.id)}&purpose=${purpose}`;

  function renderRefusal(view: RefusalView) {
    let lines: string[];
    let paymentsLink: "subscription" | "session" | null = null;
    if (view.kind === "blocked") {
      lines = blockedLines(view.block);
      paymentsLink = "subscription";
    } else if (view.kind === "sessionHeld") {
      lines = [t("members.correctPlan.refused.sessionHeld", { name: member.name, date: view.lapsesOn ? longDate(view.lapsesOn) : "" })];
      paymentsLink = "session";
    } else if (view.kind === "noSubscription") {
      lines = [t("members.correctPlan.refused.noSubscription", { name: member.name })];
    } else if (view.kind === "changed") {
      lines = [t("members.correctPlan.refused.changed")];
    } else {
      lines = [t("members.correctPlan.permissionDenied")];
    }
    return (
      <>
        <div role="alert" className="flex gap-3 rounded-md border bg-muted/30 p-4 text-sm">
          <Info size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-muted-foreground" />
          <div className="space-y-2">
            {lines.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          {paymentsLink && (
            <a
              href={paymentsHref(paymentsLink)}
              className="inline-flex h-9 items-center rounded-md border border-input px-4 text-sm font-medium shadow-sm hover:bg-accent"
            >
              {t("members.correctPlan.blocked.open")}
            </a>
          )}
          <Button type="button" onClick={onClose}>
            {t("common.close")}
          </Button>
        </div>
      </>
    );
  }

  function renderForm(current: CorrectPlanEligibility) {
    const sub = current.subscription;
    const currentName = planNameWithSummary(
      t,
      { name: sub.planName, planType: sub.planType, price: sub.price, durationDays: sub.durationDays, billingInterval: sub.billingInterval },
      locale,
    );
    const detail =
      sub.expiryDate === null
        ? t("members.correctPlan.currentDetailNoExpiry", { start: longDate(sub.startDate) })
        : t("members.correctPlan.currentDetail", { start: longDate(sub.startDate), expiry: longDate(sub.expiryDate) });
    return (
      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
        <p className="text-sm text-muted-foreground">{t("members.correctPlan.intro")}</p>

        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">{t("members.correctPlan.current")}</p>
          <p className="text-sm font-medium">{currentName}</p>
          <p className="text-sm text-muted-foreground">{detail}</p>
        </div>

        {options.length === 0 ? (
          <div className="space-y-2 rounded-md border bg-muted/30 p-4 text-sm">
            <p>{t("members.correctPlan.noOtherPlan")}</p>
            <a href="/plans" className="text-primary underline-offset-2 hover:underline">
              {t("members.correctPlan.noOtherPlanLink")}
            </a>
          </div>
        ) : (
          <>
            <div className="space-y-2">
              <Label htmlFor="correctPlanNew">{t("members.correctPlan.newPlan.label")} *</Label>
              <select
                id="correctPlanNew"
                value={planId}
                onChange={(e) => {
                  setPlanId(e.target.value);
                  setPlanError(null);
                }}
                disabled={submitting}
                aria-invalid={planError !== null}
                aria-describedby={planError ? "correctPlanNewError" : undefined}
                className={selectClassName}
              >
                <option value="">{t("members.correctPlan.newPlan.placeholder")}</option>
                {options.map((plan) => (
                  <option key={plan.id} value={plan.id}>
                    {planOptionLabel(t, plan, locale)}
                  </option>
                ))}
              </select>
              {planError && (
                <p id="correctPlanNewError" role="alert" className="text-sm text-red-600">
                  {planError === "same"
                    ? t("members.correctPlan.refused.samePlan", { name: member.name })
                    : t("members.correctPlan.refused.planGone")}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="correctPlanReason">{t("members.correctPlan.reason.label")} *</Label>
              <textarea
                id="correctPlanReason"
                value={reason}
                onChange={(e) => {
                  setReason(e.target.value);
                  setReasonError(false);
                }}
                maxLength={CORRECT_PLAN_REASON_MAX_LENGTH}
                placeholder={t("members.correctPlan.reason.placeholder")}
                disabled={submitting}
                aria-invalid={reasonError}
                className="flex min-h-20 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
              <p className="text-right text-xs text-muted-foreground">
                {t("members.correctPlan.reason.count", { count: reason.length })}
              </p>
              {reasonError && (
                <p role="alert" className="text-sm text-red-600">
                  {t("members.correctPlan.reason.error")}
                </p>
              )}
            </div>

            <div className="space-y-1 text-sm">
              <p>{t("members.correctPlan.rule", { date: longDate(sub.startDate) })}</p>
              <p className="flex gap-2 text-muted-foreground">
                <Info size={14} aria-hidden="true" className="mt-0.5 shrink-0" />
                <span>
                  {t("members.correctPlan.appNote", { name: member.name })} {t("members.correctPlan.feeNote")}
                </span>
              </p>
            </div>

            {isSupport && (
              <div className="space-y-2">
                <p className="text-sm font-medium">{t("members.correctPlan.supportAbout", { name: member.name })}</p>
                <SupportCodeField id="correctPlanAuthCode" value={authCode} onChange={setAuthCode} disabled={submitting} />
              </div>
            )}

            {networkError && (
              <p role="alert" className="text-sm text-red-600">
                {t("members.correctPlan.network")}
              </p>
            )}
            {actionError && (
              <p role="alert" className="text-sm text-red-600">
                {actionError}
              </p>
            )}
          </>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
            {options.length === 0 ? t("common.close") : t("common.cancel")}
          </Button>
          {options.length > 0 && (
            <Button type="submit" disabled={!canSubmit}>
              {submitting ? t("members.correctPlan.confirming") : t("members.correctPlan.confirm")}
            </Button>
          )}
        </div>
      </form>
    );
  }

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      onCancel={(e) => {
        // Escape closes the modal (a correction is not a destructive confirmation), but not while a call is in flight.
        if (submitting) e.preventDefault();
      }}
      aria-labelledby="correctPlanTitle"
      className="max-h-[90vh] w-full max-w-[520px] overflow-y-auto rounded-md border bg-background p-0 text-foreground backdrop:bg-black/50"
    >
      <div className="space-y-4 p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="correctPlanTitle" className="text-lg font-semibold">
              {t("members.correctPlan.title")}
            </h2>
            <p className="text-sm text-muted-foreground">{member.name}</p>
          </div>
          <button
            type="button"
            aria-label={t("common.close")}
            onClick={onClose}
            disabled={submitting}
            className="text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            <X size={16} />
          </button>
        </div>

        {phase.kind === "loading" && (
          <div role="status" aria-live="polite" className="space-y-3">
            <p className="text-sm text-muted-foreground">{t("members.correctPlan.checking")}</p>
            <div aria-hidden="true" className="space-y-2">
              <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
              <div className="h-9 w-full animate-pulse rounded bg-muted" />
              <div className="h-20 w-full animate-pulse rounded bg-muted" />
            </div>
          </div>
        )}

        {phase.kind === "loadError" && (
          <>
            <p role="alert" className="text-sm text-red-600">
              {t("members.correctPlan.loadError")}
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={onClose}>
                {t("common.close")}
              </Button>
              <Button type="button" onClick={() => void load()}>
                {t("members.correctPlan.retry")}
              </Button>
            </div>
          </>
        )}

        {phase.kind === "refusal" && renderRefusal(phase.view)}
        {phase.kind === "ready" && renderForm(phase.eligibility)}
      </div>
    </dialog>
  );
}
