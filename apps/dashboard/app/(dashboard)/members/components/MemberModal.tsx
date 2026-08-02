"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { createMemberSchema, editMemberSchema } from "@gymos/types";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { MemberListRow, MemberSubscriptionStatus } from "@/services/members";
import type { PlanRow } from "@/services/plans";
import type { CoachRow, CoachAssignmentRow } from "@/services/coaches";
import { createMember, editMember, assignCoach, getCoachAssignments } from "../actions";
import { resolveBadgeStatus, STATUS_BADGE_CONFIG } from "../memberLabels";

interface FieldErrors {
  name?: string;
  phone?: string;
  email?: string;
  dob?: string;
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

const emptyForm = {
  name: "",
  phone: "",
  email: "",
  dob: "",
  photoUrl: "",
  emergencyContact: "",
  planId: "",
  joinDate: todayLocalDateString(),
  subscriptionStatus: "active" as MemberSubscriptionStatus,
  expiryDate: "",
  coachId: "",
};

function formFromMember(member: MemberListRow | null) {
  if (!member) return emptyForm;
  return {
    name: member.name,
    phone: member.phone ?? "",
    email: member.email ?? "",
    dob: member.dob ?? "",
    photoUrl: member.photoUrl ?? "",
    emergencyContact: member.emergencyContact ?? "",
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
  onClose,
  onSaved,
}: {
  open: boolean;
  readOnly: boolean;
  editingMember: MemberListRow | null;
  plans: PlanRow[];
  coaches: CoachRow[];
  onClose: () => void;
  onSaved: (warning?: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [form, setForm] = useState(emptyForm);
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

  const isCreate = !editingMember;
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
      expiryDate: plan?.planType === "pay_per_session" ? "" : form.expiryDate,
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFieldErrors({});
    setFormError(null);

    if (isCreate) {
      const parsed = createMemberSchema.safeParse({
        name: form.name,
        phone: form.phone,
        email: form.email.trim() === "" ? null : form.email,
        dob: form.dob === "" ? null : form.dob,
        photoUrl: form.photoUrl.trim() === "" ? null : form.photoUrl,
        emergencyContact: form.emergencyContact.trim() === "" ? null : form.emergencyContact,
        planId: form.planId,
        joinDate: form.joinDate,
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
        onSaved();
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
            </div>
          </>
        ) : (
          <>
            <div className="space-y-2">
              <Label htmlFor="memberName">{t("members.modal.name")}</Label>
              <Input
                id="memberName"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
              {fieldErrors.name && <p className="text-sm text-red-600">{fieldErrors.name}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="memberPhone">{t("members.modal.phone")}</Label>
              <Input
                id="memberPhone"
                value={form.phone}
                disabled={isEdit}
                placeholder="+237600000000"
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
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
                value={form.emergencyContact}
                onChange={(e) => setForm({ ...form, emergencyContact: e.target.value })}
              />
            </div>

            {isCreate && (
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
                    onChange={(e) => setForm({ ...form, joinDate: e.target.value })}
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
               above (gated to isCreate only), this is rendered
               unconditionally in both Create and Edit mode. Reassignment
               (AC #2) has to be reachable after a member already exists,
               which Edit mode is the only path for. */}
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

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={resetAndClose} disabled={submitting}>
            {readOnly ? t("common.close") : t("common.cancel")}
          </Button>
          {!readOnly && (
            <Button type="submit" disabled={submitting}>
              {submitting
                ? t("common.saving")
                : isCreate
                  ? t("members.addMemberButton")
                  : t("members.modal.saveChanges")}
            </Button>
          )}
        </div>
      </form>
    </dialog>
  );
}
