"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { createFeeGymMemberSchema, createMemberSchema, editMemberSchema } from "@gymos/types";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PhoneInput } from "@/components/ui/phone-input";
import type { MemberListRow, MemberRegistrationFeeState, MemberSubscriptionStatus } from "@/services/members";
import type { PlanRow } from "@/services/plans";
import type { CoachRow, CoachAssignmentRow } from "@/services/coaches";
import { createMember, editMember, assignCoach, getCoachAssignments, getMemberLoyaltyAction } from "../actions";
import {
  getMemberRegistrationFeeStateAction,
  listMemberGuestSessionsAction,
} from "@/app/(dashboard)/payments/actions";
import { RecordSessionPaymentDialog } from "@/components/shared/RecordSessionPaymentDialog";
import type { MemberGuestSession } from "@/services/guestSessions";
import type { MemberLoyalty } from "@/services/loyalty";
import { PAYMENT_METHOD_LABEL_KEY } from "@/app/(dashboard)/payments/paymentLabels";
import { resolveBadgeStatus, STATUS_BADGE_CONFIG } from "../memberLabels";

interface FieldErrors {
  name?: string;
  phone?: string;
  email?: string;
  dob?: string;
  birthYear?: string;
  profession?: string;
  neighborhood?: string;
  planId?: string;
  joinDate?: string;
  expiryDate?: string;
}

const SUBSCRIPTION_STATUSES: MemberSubscriptionStatus[] = [
  "active",
  "expiring_soon",
  "grace_period",
  "expired",
];

const SUBSCRIPTION_STATUS_LABEL_KEY: Record<MemberSubscriptionStatus, string> = {
  active: "members.status.active",
  expiring_soon: "members.status.expiringSoon",
  grace_period: "members.status.gracePeriod",
  expired: "members.status.expired",
};

// createMemberSchema/editMemberSchema's own issue messages are hardcoded
// English literals (matches plan.ts/gym.ts/tier.ts's established,
// project-wide pattern) -- map every reachable field to its own translated
// fallback instead of ever displaying issue.message directly (matches
// PlanModal's own FIELD_ERROR_KEY discipline).
const FIELD_ERROR_KEY: Record<keyof FieldErrors, string> = {
  name: "members.modal.errors.nameInvalid",
  phone: "members.modal.errors.phoneInvalid",
  email: "members.modal.errors.emailInvalid",
  dob: "members.modal.errors.dobInvalid",
  birthYear: "members.modal.errors.birthYearInvalid",
  profession: "members.modal.errors.professionInvalid",
  neighborhood: "members.modal.errors.neighborhoodInvalid",
  planId: "members.modal.errors.planRequired",
  joinDate: "members.modal.errors.joinDateInvalid",
  expiryDate: "members.modal.errors.expiryDateInvalid",
};

// new Date().toISOString() always renders the UTC calendar date, not the
// viewer's local one -- for a UTC+1 viewer (this product's Cameroon market),
// that silently shows yesterday's date for the first hour after local
// midnight (code review fix; packages/types/src/schemas/member.ts's own
// comment already warns against mixing new Date()'s local/UTC clocks into
// date-only comparisons -- this reintroduced that exact bug class in the UI).
function todayLocalDateString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// Expiry was previously left for the user to fill in by hand -- easy to
// forget, and the resulting empty value then failed createMember's
// server-side expiryRequired check with a "needed for this plan" error that
// reads like a plan-selection problem even though the plan itself was picked
// correctly. Deriving it from the plan's own duration_days removes that trap
// entirely; the field stays editable afterward for a manual override.
function computeExpiryDate(joinDate: string, plan: PlanRow | null): string {
  if (!plan || plan.planType === "pay_per_session" || plan.durationDays == null || joinDate === "") {
    return "";
  }
  const [year, month, day] = joinDate.split("-").map(Number);
  const d = new Date(year, month - 1, day);
  d.setDate(d.getDate() + plan.durationDays);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

// Pre-filled rather than left blank with a "+237600000000" placeholder --
// the placeholder disappears the moment the user starts typing, so it
// silently dropped the country code prefix (this product's Cameroon market,
// same context as todayLocalDateString above) unless the user remembered to
// type it themselves first. A real value here means they only ever type the
// subscriber number; still fully editable for any non-Cameroon number.
const DEFAULT_PHONE_PREFIX = "+237";

const emptyForm = {
  name: "",
  phone: DEFAULT_PHONE_PREFIX,
  email: "",
  dob: "",
  photoUrl: "",
  emergencyContact: "",
  birthYear: "",
  profession: "",
  neighborhood: "",
  planId: "",
  joinDate: todayLocalDateString(),
  subscriptionStatus: "active" as MemberSubscriptionStatus,
  expiryDate: "",
  coachId: "",
};

// Story 26.1: blank saves as null. A birth year that is not exactly four digits
// becomes NaN so the schema refuses it and the error shows inline on the field.
function profileFieldsFromForm(form: { birthYear: string; profession: string; neighborhood: string }) {
  const year = form.birthYear.trim();
  return {
    birthYear: year === "" ? null : /^\d{4}$/.test(year) ? Number(year) : Number.NaN,
    profession: form.profession.trim() === "" ? null : form.profession,
    neighborhood: form.neighborhood.trim() === "" ? null : form.neighborhood,
  };
}

function formFromMember(member: MemberListRow | null) {
  if (!member) return emptyForm;
  return {
    name: member.name,
    phone: member.phone ?? "",
    email: member.email ?? "",
    dob: member.dob ?? "",
    photoUrl: member.photoUrl ?? "",
    emergencyContact: member.emergencyContact ?? "",
    birthYear: member.birthYear == null ? "" : String(member.birthYear),
    profession: member.profession ?? "",
    neighborhood: member.neighborhood ?? "",
    planId: member.planId ?? "",
    joinDate: member.joinDate,
    subscriptionStatus: (member.status === "no_active_plan" ? "active" : member.status),
    expiryDate: member.expiryDate ?? "",
    // Patched shortly after by the coach-assignment fetch effect below (Story
    // 5.1) -- MemberListRow carries no coach data of its own.
    coachId: "",
  };
}

const selectClassName =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

// MembersPageClient.tsx's exact local-date-parsing pattern -- avoids the
// UTC-shift bug from parsing a "YYYY-MM-DD" string via `new Date(string)`
// directly. Per-file copy, this app's established convention.
function formatLocalDate(dateOnly: string, locale: string): string {
  const [year, month, day] = dateOnly.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(locale);
}

// View mode's read-only label/value pair -- replaces a disabled Input with
// plain text, matching a real profile-detail presentation instead of a
// grayed-out form.
function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-medium">{value}</p>
    </div>
  );
}

/**
 * Story 19.9b: a member's paid sessions. Unused ones first (soonest lapse
 * first), then used ones, then muted lapsed/voided history (90 days).
 */
function SessionsSection({
  memberId,
  rows,
  loaded,
  locale,
}: {
  memberId: string;
  rows: MemberGuestSession[];
  loaded: boolean;
  locale: string;
}) {
  const { t } = useTranslation();
  // A render-time Date.now() is impure (React Compiler lint); one stable timestamp per mount is enough here.
  const [now] = useState(() => Date.now());
  const dateTime = (iso: string) =>
    new Date(iso).toLocaleString(locale, { dateStyle: "short", timeStyle: "short" });
  const date = (iso: string) => new Date(iso).toLocaleDateString(locale);
  const methodLabel = (method: string | null) => {
    if (!method) return null;
    const key = PAYMENT_METHOD_LABEL_KEY[method];
    return key ? t(key) : method;
  };

  const unused = rows
    .filter((r) => !r.consumedAt && !r.voidedAt && new Date(r.usableUntil).getTime() >= now)
    .sort((a, b) => (a.usableUntil < b.usableUntil ? -1 : 1));
  const used = rows.filter((r) => r.consumedAt && !r.voidedAt);
  const history = rows.filter(
    (r) => r.voidedAt || (!r.consumedAt && new Date(r.usableUntil).getTime() < now),
  );

  return (
    <section className="space-y-3 border-t pt-4" aria-label={t("members.modal.sessions.title")}>
      <h4 className="text-sm font-semibold">{t("members.modal.sessions.title")}</h4>

      {loaded && rows.length === 0 && (
        <p className="text-sm text-muted-foreground">{t("members.modal.sessions.empty")}</p>
      )}

      {unused.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">{t("members.modal.sessions.unused")}</p>
          <ul className="space-y-1 text-sm">
            {unused.map((row) => (
              <li key={row.id} className="rounded-md border p-2">
                <span className="font-medium">
                  {row.source === "paid"
                    ? t("members.modal.sessions.sourcePaid")
                    : t("members.modal.sessions.sourceFree")}
                </span>
                {" · "}
                {dateTime(row.createdAt)}
                {methodLabel(row.method) && " · " + methodLabel(row.method)}
                {row.recordedByName && " · " + t("members.modal.sessions.recordedBy", { name: row.recordedByName })}
                <span className="block text-xs text-muted-foreground">
                  {t("members.modal.sessions.lapsesOn", { date: date(row.usableUntil) })}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {used.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">{t("members.modal.sessions.used")}</p>
          <ul className="space-y-1 text-sm">
            {used.map((row) => (
              <li key={row.id} className="rounded-md border p-2">
                {t("members.modal.sessions.usedOn", { date: date(row.consumedAt as string) })}
                {row.coveredDay &&
                  ` · ${t("members.modal.sessions.covered", { date: formatLocalDate(row.coveredDay, locale) })}`}
              </li>
            ))}
          </ul>
        </div>
      )}

      {history.length > 0 && (
        <ul className="space-y-1 text-xs text-muted-foreground">
          {history.map((row) => (
            <li key={row.id}>
              {row.voidedAt
                ? t("members.modal.sessions.voided", { date: date(row.voidedAt) })
                : t("members.modal.sessions.lapsed", { date: date(row.usableUntil) })}
            </li>
          ))}
        </ul>
      )}

      <a
        href={`/payments?memberId=${encodeURIComponent(memberId)}&purpose=session`}
        className="inline-block text-sm text-primary underline-offset-2 hover:underline"
      >
        {t("members.modal.sessions.viewPayments")}
      </a>
    </section>
  );
}

/**
 * Story 20.5 (AD-04): a member's loyalty progress and free sessions, from
 * `effective_loyalty` only. Read-only for every role: there is deliberately
 * no input, button or link here that changes a balance (FR-170). Unused paid
 * sessions are not repeated; the Sessions section owns them.
 */
function RewardsSection({ loyalty, locale }: { loyalty: MemberLoyalty; locale: string }) {
  const { t } = useTranslation();
  const date = (iso: string) => new Date(iso).toLocaleDateString(locale);

  return (
    <section className="space-y-3 border-t pt-4" aria-label={t("members.modal.rewards.title")}>
      <h4 className="text-sm font-semibold">{t("members.modal.rewards.title")}</h4>

      {loyalty.enabled && (
        <div className="grid grid-cols-2 gap-3">
          {loyalty.guestThreshold !== null && (
            <DetailField
              label={t("members.modal.rewards.guestProgress")}
              value={`${loyalty.guestStamps} / ${loyalty.guestThreshold}`}
            />
          )}
          {loyalty.renewalThreshold !== null && (
            <DetailField
              label={t("members.modal.rewards.subscriberProgress")}
              value={`${loyalty.subscriberStamps} / ${loyalty.renewalThreshold}`}
            />
          )}
        </div>
      )}

      {loyalty.freeSessions.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">{t("members.modal.rewards.freeSessions")}</p>
          <ul className="space-y-1 text-sm">
            {loyalty.freeSessions.map((row) => (
              <li key={row.id} className="rounded-md border p-2">
                {t("members.modal.rewards.freeSession")}
                <span className="block text-xs text-muted-foreground">
                  {t("members.modal.rewards.lapsesOn", { date: date(row.usableUntil) })}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="text-xs text-muted-foreground">{t("members.modal.rewards.rulesOnly")}</p>
    </section>
  );
}

/** Create/Edit/View Member. One modal, three modes -- native <dialog>,
 * controlled string-based form state (matches PlanModal/TierModal's
 * established convention, not react-hook-form). `readOnly` is Scope Note
 * #8's "View" mode (AD-04's own tabbed detail page is deferred -- this
 * story's "View" action and row-click both open this same modal instead,
 * read-only for Receptionist, edit mode for Manager/Owner). Create mode
 * shows the full AD-05 form minus Assigned Coach (Scope Note #5, no backing
 * table yet) and Billing Interval as a real input (Scope Note #6, read-only
 * display instead). Edit mode shows identity fields only (Scope Note's
 * Edit-mode boundary) -- plan/join date/subscription status/expiry are
 * shown read-only in View mode but never rendered as editable inputs in
 * Edit mode. */
export function MemberModal({
  open,
  readOnly,
  editingMember,
  plans,
  coaches,
  registrationFee = 0,
  role,
  chargeGuestsPerSession = false,
  onSessionRecorded,
  onClose,
  onSaved,
}: {
  open: boolean;
  readOnly: boolean;
  editingMember: MemberListRow | null;
  plans: PlanRow[];
  coaches: CoachRow[];
  /** Story 18.5: the gym's registration fee, from the server. Above 0 the
   * create form omits plan, status and expiry -- the member is created
   * awaiting the fee and gets the first plan afterward. createMember re-reads
   * the fee server-side and stays authoritative. */
  registrationFee?: number;
  /** Story 19.9b: the signed-in staff role. The Sessions section and the
   * Record session payment action are receptionist-and-above; absent or coach
   * shows neither. */
  role?: string;
  /** Story 19.9b: whether the gym charges Pay-per-session guests per session. */
  chargeGuestsPerSession?: boolean;
  /** Story 19.9b: a session payment was recorded from this modal. */
  onSessionRecorded?: (memberName: string) => void;
  onClose: () => void;
  /** `invite` is set only when creation itself tried to send the WhatsApp invite (fee-0 gym). */
  onSaved: (warning?: string, invite?: "sent" | "failed") => void;
}) {
  const { t, i18n } = useTranslation();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [currentYear] = useState(() => new Date().getUTCFullYear());
  const [form, setForm] = useState(emptyForm);
  // Create mode only: Personal Info (step 1) / Membership (step 2) -- the
  // single-column form crammed 11 fields into one scroll, easy to lose track
  // of what's still required. Edit mode has too few fields (identity only,
  // Scope Note's Edit-mode boundary) to need this and stays single-step.
  const [step, setStep] = useState<1 | 2>(1);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Story 5.1: coach assignment history + the coach the modal opened with
  // (for handleSubmit's "did the selection actually change" check below).
  const [assignmentHistory, setAssignmentHistory] = useState<CoachAssignmentRow[]>([]);
  const [currentCoachId, setCurrentCoachId] = useState("");
  const [loadingAssignments, setLoadingAssignments] = useState(false);
  // View mode's photo avatar -- falls back to the initial-letter circle if
  // the member's stored photoUrl is broken/unreachable, rather than showing
  // a native broken-image icon.
  const [photoLoadFailed, setPhotoLoadFailed] = useState(false);
  // Story 18.6: the read-only view's registration fee line, loaded on open for
  // this one member. Keyed by member id so a stale result never shows under a
  // different member.
  const [feeLine, setFeeLine] = useState<{ memberId: string; state: MemberRegistrationFeeState } | null>(null);

  // Story 19.9b: Sessions section + header action state.
  const [guestSessions, setGuestSessions] = useState<{ memberId: string; rows: MemberGuestSession[] } | null>(
    null,
  );
  const [recordingSession, setRecordingSession] = useState(false);
  const [sessionsReloadKey, setSessionsReloadKey] = useState(0);
  // Story 20.5: Rewards section state, keyed by member id like the above.
  const [loyalty, setLoyalty] = useState<{ memberId: string; value: MemberLoyalty } | null>(null);

  const isCreate = !editingMember;
  const isFeeGymCreate = isCreate && registrationFee > 0;
  const isEdit = Boolean(editingMember) && !readOnly;

  // Adjusted during render (React's documented alternative to an
  // effect-only sync), matches PlanModal's own established pattern -- also
  // catches editingMember changing reference while the dialog stays open
  // (switching from one member's View to another's, e.g.).
  const [syncedWith, setSyncedWith] = useState<{ open: boolean; editingMember: MemberListRow | null }>({
    open: false,
    editingMember: null,
  });
  if (open && (!syncedWith.open || syncedWith.editingMember !== editingMember)) {
    setSyncedWith({ open, editingMember });
    setForm(formFromMember(editingMember));
    setStep(1);
    setFieldErrors({});
    setFormError(null);
    // Reset to avoid flashing the previous member's (or a stale) coach
    // assignment data before the fetch effect below repopulates it. Set here
    // (render phase), not inside the effect's body, to avoid an unconditional
    // synchronous setState-in-effect (react-hooks/set-state-in-effect).
    setAssignmentHistory([]);
    setCurrentCoachId("");
    setLoadingAssignments(Boolean(editingMember));
    setPhotoLoadFailed(false);
  } else if (!open && syncedWith.open) {
    setSyncedWith({ open, editingMember });
  }

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  // Story 5.1 (AC #1, #3): fetch the existing member's current coach +
  // assignment history on open (Edit and View mode both need it -- Manager/
  // Owner see it in Edit mode for reassignment context, Receptionist/View
  // mode shows it read-only). Create mode has no member yet, so this is
  // skipped entirely and form.coachId/assignmentHistory stay at their
  // just-reset empty values above.
  useEffect(() => {
    if (!open || !editingMember) return;
    let cancelled = false;
    getCoachAssignments(editingMember.id).then(({ data }) => {
      if (cancelled) return;
      setCurrentCoachId(data?.current?.coachId ?? "");
      setAssignmentHistory(data?.history ?? []);
      setForm((f) => ({ ...f, coachId: data?.current?.coachId ?? "" }));
      setLoadingAssignments(false);
    });
    return () => {
      cancelled = true;
    };
  }, [open, editingMember]);

  // Story 18.6: only a gym that charges a fee (or still has this member
  // awaiting one) has a fee line; a fee-0 gym fetches nothing and shows nothing.
  useEffect(() => {
    // Drop any earlier line first: a reopened View must not flash the previous
    // state, and a failed fetch must leave no line rather than a wrong one.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFeeLine(null);
    if (!open || !readOnly || !editingMember) return;
    if (registrationFee <= 0 && editingMember.registrationFeeSettledAt !== null) return;
    const memberId = editingMember.id;
    let cancelled = false;
    getMemberRegistrationFeeStateAction(memberId)
      .then(({ data }) => {
        if (cancelled || !data) return;
        setFeeLine({ memberId, state: data });
      })
      .catch(() => {
        // The line is informational: a failed read leaves it out.
      });
    return () => {
      cancelled = true;
    };
  }, [open, readOnly, editingMember, registrationFee]);

  // Story 19.9b: only receptionist-and-above see session data; a coach sees
  // nothing here. Absent role (callers that do not thread it) shows nothing.
  const canSeeSessions =
    readOnly &&
    Boolean(editingMember) &&
    (role === "receptionist" || role === "manager" || role === "supervisor" || role === "owner");

  useEffect(() => {
    // Drop an earlier member's list first, same as the fee line above.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setGuestSessions(null);
    if (!open || !canSeeSessions || !editingMember) return;
    const memberId = editingMember.id;
    let cancelled = false;
    listMemberGuestSessionsAction(memberId)
      .then(({ data }) => {
        if (cancelled || !data) return;
        setGuestSessions({ memberId, rows: data });
      })
      .catch(() => {
        // Informational: a failed read leaves the section out.
      });
    return () => {
      cancelled = true;
    };
  }, [open, canSeeSessions, editingMember, sessionsReloadKey]);

  // Story 20.5: same gate as Sessions. A null result (suspended gym) or a
  // failed read leaves the section out.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoyalty(null);
    if (!open || !canSeeSessions || !editingMember) return;
    const memberId = editingMember.id;
    let cancelled = false;
    getMemberLoyaltyAction(memberId)
      .then(({ data }) => {
        if (cancelled || !data) return;
        setLoyalty({ memberId, value: data });
      })
      .catch(() => {
        // Informational: a failed read leaves the section out.
      });
    return () => {
      cancelled = true;
    };
  }, [open, canSeeSessions, editingMember, sessionsReloadKey]);

  function registrationFeeLineText(state: MemberRegistrationFeeState): string {
    if (state.kind === "awaiting") return t("members.feeState.awaiting");
    if (state.kind === "paid") {
      return t("members.feeState.paid", {
        amount: state.amount.toLocaleString(i18n.language),
        date: new Date(state.paidAt).toLocaleDateString(i18n.language),
      });
    }
    if (state.kind === "waived") {
      return state.waivedByName
        ? t("members.feeState.waivedBy", { name: state.waivedByName })
        : t("members.feeState.waived");
    }
    return "";
  }

  const memberPlan = editingMember?.planId ? (plans.find((p) => p.id === editingMember.planId) ?? null) : null;
  const memberIsPayPerSession = editingMember?.planType === "pay_per_session";
  const memberSessionRows =
    guestSessions && editingMember && guestSessions.memberId === editingMember.id ? guestSessions.rows : [];
  // Charging on, Pay-per-session, a real price, and a viewer who can record.
  const showRecordSession =
    canSeeSessions &&
    chargeGuestsPerSession &&
    memberIsPayPerSession &&
    (memberPlan?.price ?? 0) > 0 &&
    editingMember?.deactivatedAt == null;
  const showSessionsSection =
    canSeeSessions && ((memberIsPayPerSession && chargeGuestsPerSession) || memberSessionRows.length > 0);

  const selectedPlan = plans.find((p) => p.id === form.planId) ?? null;
  const isPayPerSession = selectedPlan?.planType === "pay_per_session";

  function resetAndClose() {
    onClose();
  }

  // Expiry Date is hidden + cleared when the selected plan's plan_type is
  // pay_per_session (mirrors PlanModal's own pay_per_session field-hiding
  // precedent from Story 2.2, applied here to the subscription's expiry
  // instead of the plan's own duration).
  function handlePlanChange(planId: string) {
    const plan = plans.find((p) => p.id === planId) ?? null;
    setForm({
      ...form,
      planId,
      expiryDate: computeExpiryDate(form.joinDate, plan),
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    // Step 1's "Next" is this same submit button (native Enter-to-submit on
    // a step-1 input must not fall through to the full create below, which
    // would fail on step 2's still-empty planId with no visible field to
    // show that error on) -- advance instead of validating/saving.
    if (isCreate && step === 1) {
      setStep(2);
      return;
    }

    setFieldErrors({});
    setFormError(null);

    if (isCreate) {
      const identityFields = {
        name: form.name,
        phone: form.phone,
        email: form.email.trim() === "" ? null : form.email,
        dob: form.dob === "" ? null : form.dob,
        photoUrl: form.photoUrl.trim() === "" ? null : form.photoUrl,
        emergencyContact: form.emergencyContact.trim() === "" ? null : form.emergencyContact,
        ...profileFieldsFromForm(form),
        joinDate: form.joinDate,
      };
      // Fee gym: no plan, status or expiry in the parse or the createMember
      // call below -- the server would reject them with registration_fee_due.
      const parsed = isFeeGymCreate
        ? createFeeGymMemberSchema.safeParse(identityFields)
        : createMemberSchema.safeParse({
            ...identityFields,
            planId: form.planId,
            subscriptionStatus: form.subscriptionStatus,
            expiryDate: isPayPerSession || form.expiryDate === "" ? null : form.expiryDate,
          });

      if (!parsed.success) {
        const errors: FieldErrors = {};
        for (const issue of parsed.error.issues) {
          const field = issue.path[0] as keyof FieldErrors;
          if (!errors[field] && FIELD_ERROR_KEY[field]) {
            errors[field] = t(FIELD_ERROR_KEY[field]);
          }
        }
        setFieldErrors(errors);
        // Step 2 is the only place submit can be reached from, but a
        // validation failure can still land on step 1's own fields (name/
        // phone/email/dob) -- jump back so the error is actually visible
        // instead of stranded behind the membership step.
        if (
          errors.name ||
          errors.phone ||
          errors.email ||
          errors.dob ||
          errors.birthYear ||
          errors.profession ||
          errors.neighborhood
        ) {
          setStep(1);
        }
        return;
      }

      setSubmitting(true);
      try {
        const { data, error } = await createMember(parsed.data);
        if (error) {
          if (error.code === "audit_log_failed") {
            onSaved(error.message);
            return;
          }
          if (error.code === "member_already_active_at_gym") {
            setFieldErrors({ phone: error.message });
            setStep(1);
          } else {
            setFormError(error.message);
          }
          return;
        }
        // Story 5.1: the member record already saved successfully above --
        // an assignCoach failure here does not fail the whole save, matching
        // the audit_log_failed branch's own "warning toast, not a blocking
        // error" precedent.
        if (data && form.coachId) {
          const { error: assignError } = await assignCoach({ memberId: data.id, coachId: form.coachId });
          if (assignError) {
            onSaved(assignError.message);
            return;
          }
        }
        onSaved(undefined, data?.inviteSent === undefined ? undefined : data.inviteSent ? "sent" : "failed");
      } catch {
        setFormError(t("common.somethingWentWrong"));
      } finally {
        setSubmitting(false);
      }
      return;
    }

    if (isEdit && editingMember) {
      const parsed = editMemberSchema.safeParse({
        name: form.name,
        email: form.email.trim() === "" ? null : form.email,
        dob: form.dob === "" ? null : form.dob,
        photoUrl: form.photoUrl.trim() === "" ? null : form.photoUrl,
        emergencyContact: form.emergencyContact.trim() === "" ? null : form.emergencyContact,
        ...profileFieldsFromForm(form),
      });

      if (!parsed.success) {
        const errors: FieldErrors = {};
        for (const issue of parsed.error.issues) {
          const field = issue.path[0] as keyof FieldErrors;
          if (!errors[field] && FIELD_ERROR_KEY[field]) {
            errors[field] = t(FIELD_ERROR_KEY[field]);
          }
        }
        setFieldErrors(errors);
        return;
      }

      setSubmitting(true);
      try {
        const { error } = await editMember(editingMember.id, parsed.data);
        if (error) {
          if (error.code === "audit_log_failed") {
            onSaved(error.message);
            return;
          }
          setFormError(error.message);
          return;
        }
        // Story 5.1: only call assignCoach if the selection actually changed
        // from the coach the modal opened with -- re-submitting the same
        // assignment would otherwise needlessly end-and-restart it (and
        // double-log an audit entry) every time the member is edited.
        if (form.coachId && form.coachId !== currentCoachId) {
          const { error: assignError } = await assignCoach({
            memberId: editingMember.id,
            coachId: form.coachId,
          });
          if (assignError) {
            onSaved(assignError.message);
            return;
          }
        }
        onSaved();
      } catch {
        setFormError(t("common.somethingWentWrong"));
      } finally {
        setSubmitting(false);
      }
    }
  }

  return (
    <>
    <dialog
      ref={dialogRef}
      onClose={resetAndClose}
      onCancel={(e) => {
        if (submitting) e.preventDefault();
      }}
      className="w-full max-w-[520px] rounded-md border bg-background p-0 text-foreground backdrop:bg-black/50"
    >
      <form onSubmit={handleSubmit} className="space-y-4 p-6">
        <div className="flex items-center justify-between">
          {/* View mode's name already appears as the profile hero heading
             below -- repeating it here too would be redundant, so this stays
             an empty (but layout-preserving) spacer for that mode only. */}
          <h2 className="text-lg font-semibold">
            {isCreate
              ? t("members.modal.addTitle")
              : readOnly
                ? ""
                : t("members.modal.editTitle", { name: editingMember?.name ?? "" })}
          </h2>
          <button
            type="button"
            aria-label={t("members.modal.close")}
            onClick={resetAndClose}
            disabled={submitting}
            className="text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            <X size={16} />
          </button>
        </div>

        {isCreate && (
          <div className="flex items-center gap-2 text-xs">
            <span
              className={
                step === 1 ? "font-semibold text-foreground" : "text-muted-foreground"
              }
            >
              1. {t("members.modal.stepPersonal")}
            </span>
            <span className="h-px flex-1 bg-border" />
            <span
              className={
                step === 2 ? "font-semibold text-foreground" : "text-muted-foreground"
              }
            >
              2. {t("members.modal.stepMembership")}
            </span>
          </div>
        )}

        {readOnly && editingMember ? (
          <>
            <div className="flex flex-col items-center gap-3 pb-2">
              {editingMember.photoUrl && !photoLoadFailed ? (
                // An arbitrary, member-supplied external URL -- next/image
                // would require allow-listing every possible remote host.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={editingMember.photoUrl}
                  alt={editingMember.name}
                  onError={() => setPhotoLoadFailed(true)}
                  className="size-20 rounded-full border object-cover"
                />
              ) : (
                <div className="flex size-20 shrink-0 items-center justify-center rounded-full bg-muted text-2xl font-semibold">
                  {editingMember.name.slice(0, 1).toUpperCase()}
                </div>
              )}
              <div className="flex flex-col items-center gap-1">
                <h3 className="text-xl font-semibold">{editingMember.name}</h3>
                {(() => {
                  const badge = STATUS_BADGE_CONFIG[resolveBadgeStatus(editingMember)];
                  const StatusIcon = badge.icon;
                  return (
                    <Badge variant="outline" className={badge.className}>
                      <StatusIcon size={12} className="mr-1" />
                      {t(badge.labelKey)}
                    </Badge>
                  );
                })()}
              </div>
              {showRecordSession && (
                <Button type="button" variant="outline" size="sm" onClick={() => setRecordingSession(true)}>
                  {t("members.modal.recordSessionPayment")}
                </Button>
              )}
            </div>

            <div className="grid grid-cols-2 gap-x-6 gap-y-3">
              <DetailField label={t("members.modal.view.phone")} value={editingMember.phone ?? "—"} />
              <DetailField label={t("members.modal.email")} value={editingMember.email ?? "—"} />
              <DetailField
                label={t("members.modal.dob")}
                value={editingMember.dob ? formatLocalDate(editingMember.dob, i18n.language) : "—"}
              />
              <DetailField
                label={t("members.modal.emergencyContact")}
                value={editingMember.emergencyContact ?? "—"}
              />
              {editingMember.birthYear != null && (
                <DetailField
                  label={t("members.modal.view.approxAge")}
                  value={t("members.modal.view.approxAgeValue", { age: currentYear - editingMember.birthYear })}
                />
              )}
              {editingMember.profession && (
                <DetailField label={t("members.modal.profession")} value={editingMember.profession} />
              )}
              {editingMember.neighborhood && (
                <DetailField label={t("members.modal.neighborhood")} value={editingMember.neighborhood} />
              )}
              <DetailField label={t("members.modal.view.plan")} value={editingMember.planName ?? "—"} />
              <DetailField
                label={t("members.modal.view.joinDate")}
                value={formatLocalDate(editingMember.joinDate, i18n.language)}
              />
              <DetailField
                label={t("members.modal.view.subscriptionStatus")}
                value={
                  editingMember.status !== "no_active_plan"
                    ? t(SUBSCRIPTION_STATUS_LABEL_KEY[editingMember.status])
                    : "—"
                }
              />
              {!isPayPerSession && (
                <DetailField
                  label={t("members.modal.view.expiryDate")}
                  value={editingMember.expiryDate ? formatLocalDate(editingMember.expiryDate, i18n.language) : "—"}
                />
              )}
              <DetailField
                label={t("members.modal.assignedCoach")}
                value={
                  assignmentHistory.find((a) => a.endedAt === null)?.coachName ??
                  t("members.modal.noCoachAssigned")
                }
              />
              {feeLine && feeLine.memberId === editingMember.id && feeLine.state.kind !== "none" && (
                <div className="col-span-2">
                  <DetailField
                    label={t("members.modal.view.registrationFee")}
                    value={registrationFeeLineText(feeLine.state)}
                  />
                  {feeLine.state.kind === "waived" && feeLine.state.reason && (
                    <p className="text-xs text-muted-foreground">
                      {t("members.feeState.waivedReason", { reason: feeLine.state.reason })}
                    </p>
                  )}
                </div>
              )}
            </div>

            {showSessionsSection && (
              <SessionsSection
                memberId={editingMember.id}
                rows={memberSessionRows}
                loaded={guestSessions !== null && guestSessions.memberId === editingMember.id}
                locale={i18n.language}
              />
            )}

            {canSeeSessions &&
              loyalty &&
              loyalty.memberId === editingMember.id &&
              (loyalty.value.enabled || loyalty.value.freeSessions.length > 0) && (
                <RewardsSection loyalty={loyalty.value} locale={i18n.language} />
              )}
          </>
        ) : (
          <>
            {(!isCreate || step === 1) && (
              <>
            <div className="space-y-2">
              <Label htmlFor="memberName">{t("members.modal.name")}</Label>
              <Input
                id="memberName"
            className="uppercase"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
              {fieldErrors.name && <p className="text-sm text-red-600">{fieldErrors.name}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="memberPhone">{t("members.modal.phone")}</Label>
              <PhoneInput
                id="memberPhone"
                countries="global"
                value={form.phone}
                disabled={isEdit}
                onChange={(value) => setForm({ ...form, phone: value ?? "" })}
              />
              {fieldErrors.phone && <p className="text-sm text-red-600">{fieldErrors.phone}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="memberEmail">{t("members.modal.email")}</Label>
              <Input
                id="memberEmail"
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
              {fieldErrors.email && <p className="text-sm text-red-600">{fieldErrors.email}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="memberDob">{t("members.modal.dob")}</Label>
              <Input
                id="memberDob"
                type="date"
                value={form.dob}
                onChange={(e) => setForm({ ...form, dob: e.target.value })}
              />
              {fieldErrors.dob && <p className="text-sm text-red-600">{fieldErrors.dob}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="memberPhotoUrl">{t("members.modal.photoUrl")}</Label>
              <Input
                id="memberPhotoUrl"
                value={form.photoUrl}
                onChange={(e) => setForm({ ...form, photoUrl: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="memberEmergencyContact">{t("members.modal.emergencyContact")}</Label>
              <Input
                id="memberEmergencyContact"
                className="uppercase"
                value={form.emergencyContact}
                onChange={(e) => setForm({ ...form, emergencyContact: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="memberBirthYear">{t("members.modal.birthYear")}</Label>
              <Input
                id="memberBirthYear"
                inputMode="numeric"
                value={form.birthYear}
                onChange={(e) => setForm({ ...form, birthYear: e.target.value })}
              />
              {fieldErrors.birthYear && <p className="text-sm text-red-600">{fieldErrors.birthYear}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="memberProfession">{t("members.modal.profession")}</Label>
              <Input
                id="memberProfession"
            className="uppercase"
                value={form.profession}
                onChange={(e) => setForm({ ...form, profession: e.target.value })}
              />
              {fieldErrors.profession && <p className="text-sm text-red-600">{fieldErrors.profession}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="memberNeighborhood">{t("members.modal.neighborhood")}</Label>
              <Input
                id="memberNeighborhood"
            className="uppercase"
                value={form.neighborhood}
                onChange={(e) => setForm({ ...form, neighborhood: e.target.value })}
              />
              {fieldErrors.neighborhood && <p className="text-sm text-red-600">{fieldErrors.neighborhood}</p>}
            </div>
              </>
            )}

            {isFeeGymCreate && step === 2 && (
              <>
                <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                  {t("members.modal.registrationFeeNotice")}
                </p>

                <div className="space-y-2">
                  <Label htmlFor="memberJoinDate">{t("members.modal.joinDate")}</Label>
                  <Input
                    id="memberJoinDate"
                    type="date"
                    value={form.joinDate}
                    onChange={(e) => setForm({ ...form, joinDate: e.target.value })}
                  />
                  {fieldErrors.joinDate && <p className="text-sm text-red-600">{fieldErrors.joinDate}</p>}
                </div>
              </>
            )}

            {isCreate && !isFeeGymCreate && step === 2 && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="memberPlan">{t("members.modal.plan")}</Label>
                  <select
                    id="memberPlan"
                    value={form.planId}
                    onChange={(e) => handlePlanChange(e.target.value)}
                    className={selectClassName}
                  >
                    <option value="">{t("members.modal.selectPlan")}</option>
                    {plans.map((plan) => (
                      <option key={plan.id} value={plan.id}>
                        {plan.name}
                      </option>
                    ))}
                  </select>
                  {fieldErrors.planId && <p className="text-sm text-red-600">{fieldErrors.planId}</p>}
                  {selectedPlan && (
                    <p className="text-xs text-muted-foreground">
                      {t("members.modal.billingIntervalReadonly", {
                        interval:
                          selectedPlan.billingInterval === "annual"
                            ? t("plans.intervalAnnual")
                            : t("plans.intervalMonthly"),
                      })}
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="memberJoinDate">{t("members.modal.joinDate")}</Label>
                  <Input
                    id="memberJoinDate"
                    type="date"
                    value={form.joinDate}
                    onChange={(e) => {
                      const joinDate = e.target.value;
                      setForm({ ...form, joinDate, expiryDate: computeExpiryDate(joinDate, selectedPlan) });
                    }}
                  />
                  {fieldErrors.joinDate && <p className="text-sm text-red-600">{fieldErrors.joinDate}</p>}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="memberSubscriptionStatus">{t("members.modal.subscriptionStatus")}</Label>
                  <select
                    id="memberSubscriptionStatus"
                    value={form.subscriptionStatus}
                    onChange={(e) =>
                      setForm({ ...form, subscriptionStatus: e.target.value as MemberSubscriptionStatus })
                    }
                    className={selectClassName}
                  >
                    {SUBSCRIPTION_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {t(SUBSCRIPTION_STATUS_LABEL_KEY[s])}
                      </option>
                    ))}
                  </select>
                </div>

                {!isPayPerSession && (
                  <div className="space-y-2">
                    <Label htmlFor="memberExpiryDate">{t("members.modal.expiryDate")}</Label>
                    <Input
                      id="memberExpiryDate"
                      type="date"
                      value={form.expiryDate}
                      onChange={(e) => setForm({ ...form, expiryDate: e.target.value })}
                    />
                    {fieldErrors.expiryDate && (
                      <p className="text-sm text-red-600">{fieldErrors.expiryDate}</p>
                    )}
                  </div>
                )}
              </>
            )}

            {/* Story 5.1: Assignment section -- unlike the Membership block
               above (gated to isCreate only), this is rendered in both
               Create and Edit mode (Reassignment, AC #2, has to be
               reachable after a member already exists, which Edit mode is
               the only path for). Folded into step 2 for Create mode since
               it's assignment/membership context, not personal info. */}
            {(!isCreate || step === 2) && (
              <div className="space-y-2">
                <Label htmlFor="memberCoach">{t("members.modal.assignedCoach")}</Label>
                <select
                  id="memberCoach"
                  value={form.coachId}
                  disabled={loadingAssignments}
                  onChange={(e) => setForm({ ...form, coachId: e.target.value })}
                  className={selectClassName}
                >
                  <option value="">{t("members.modal.selectCoachOptional")}</option>
                  {coaches.map((coach) => (
                    <option key={coach.id} value={coach.id}>
                      {coach.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {!isCreate && assignmentHistory.length > 0 && (
              <div className="space-y-2">
                <Label>{t("members.modal.assignmentHistoryTitle")}</Label>
                <ul className="space-y-1 text-sm">
                  {assignmentHistory.map((assignment) => (
                    <li
                      key={assignment.id}
                      className="flex items-center justify-between border-b pb-1 last:border-0"
                    >
                      <span>{assignment.coachName}</span>
                      <span className="text-xs text-muted-foreground">
                        {t("members.modal.assignmentStarted", {
                          date: new Date(assignment.startedAt).toLocaleDateString(i18n.language),
                        })}
                        {" — "}
                        {assignment.endedAt === null
                          ? t("members.modal.assignmentActive")
                          : t("members.modal.assignmentEnded", {
                              date: new Date(assignment.endedAt).toLocaleDateString(i18n.language),
                            })}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}

        {formError && <p className="text-sm text-red-600">{formError}</p>}

        <div className="flex justify-between gap-2 pt-2">
          {isCreate && step === 2 ? (
            <Button type="button" variant="outline" onClick={() => setStep(1)} disabled={submitting}>
              {t("common.back")}
            </Button>
          ) : (
            <Button type="button" variant="outline" onClick={resetAndClose} disabled={submitting}>
              {readOnly ? t("common.close") : t("common.cancel")}
            </Button>
          )}
          {!readOnly && (
            <Button type="submit" disabled={submitting}>
              {isCreate && step === 1
                ? t("common.next")
                : submitting
                  ? t("common.saving")
                  : isCreate
                    ? t("members.addMemberButton")
                    : t("members.modal.saveChanges")}
            </Button>
          )}
        </div>
      </form>
    </dialog>
    {recordingSession && editingMember && (
      <RecordSessionPaymentDialog
        memberId={editingMember.id}
        memberName={editingMember.name}
        role={role}
        onClose={() => setRecordingSession(false)}
        onRecorded={() => {
          setRecordingSession(false);
          setSessionsReloadKey((key) => key + 1);
          onSessionRecorded?.(editingMember.name);
        }}
      />
    )}
    </>
  );
}
