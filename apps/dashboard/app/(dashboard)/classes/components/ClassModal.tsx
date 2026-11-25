"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { classSchema } from "@gymos/types";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { summarizeSlots } from "@/lib/classTimes";
import type { ClassRow, LeftUnchangedSession } from "@/services/classes";
import type { CoachRow } from "@/services/coaches";
import { createClass, editClass } from "../actions";
import { WeeklyTimesEditor } from "./WeeklyTimesEditor";
import {
  isAtRowLimit,
  nextRowAfter,
  normalizeTime,
  rowsFromSlots,
  rowsToSlots,
  sortRows,
  validateRows,
  type TimeRow,
} from "./weeklyRows";

type ScheduleType = ClassRow["scheduleType"];

interface FieldErrors {
  name?: string;
  coachId?: string;
  capacity?: string;
  oneOffSessionAt?: string;
  slots?: string;
  recurrenceStartDate?: string;
}

const FIELD_ERROR_KEY: Record<keyof FieldErrors, string> = {
  name: "classes.modal.errors.nameRequired",
  coachId: "classes.modal.errors.coachRequired",
  capacity: "classes.modal.errors.capacityInvalid",
  oneOffSessionAt: "classes.modal.errors.oneOffDateTimeRequired",
  slots: "classes.times.error.none",
  recurrenceStartDate: "classes.modal.errors.recurringFieldsRequired",
};

function hasLeftUnchanged(data: unknown): data is { leftUnchanged: LeftUnchangedSession[] } {
  return typeof data === "object" && data !== null && Array.isArray((data as { leftUnchanged?: unknown }).leftUnchanged);
}

let rowKeyCounter = 0;
function makeRowKey(): string {
  rowKeyCounter += 1;
  return `r${rowKeyCounter}`;
}

const emptyForm = {
  name: "",
  description: "",
  coachId: "",
  capacity: "",
  scheduleType: "one_off" as ScheduleType,
  oneOffDate: "",
  oneOffTime: "",
  rows: [] as TimeRow[],
  recurrenceStartDate: "",
};

function toDateInputValue(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function toTimeInputValue(iso: string): string {
  const d = new Date(iso);
  const h = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${h}:${min}`;
}

function formFromClass(cls: ClassRow | null) {
  if (!cls) return { ...emptyForm, rows: [{ key: makeRowKey(), weekday: "1", time: "" }] };
  return {
    name: cls.name,
    description: cls.description ?? "",
    coachId: cls.coachId,
    capacity: String(cls.capacity),
    scheduleType: cls.scheduleType,
    oneOffDate: cls.oneOffSessionAt ? toDateInputValue(cls.oneOffSessionAt) : "",
    oneOffTime: cls.oneOffSessionAt ? toTimeInputValue(cls.oneOffSessionAt) : "",
    // One row per stored slot, in week order (a migrated class opens as one row per old day at its old hour, with no label). A one-off
    // class has no slot: switching it to Recurring starts from one empty row.
    rows:
      cls.slots.length > 0
        ? rowsFromSlots(cls.slots, makeRowKey)
        : [{ key: makeRowKey(), weekday: "1", time: "" }],
    recurrenceStartDate: cls.recurrenceStartDate ?? "",
  };
}

const selectClassName =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

/** Class Create/Edit (AD-19's mockup). One modal, `editingClass` picks the
 * Server Action -- same native <dialog> pattern as PlanModal. */
export function ClassModal({
  open,
  onClose,
  onSaved,
  editingClass,
  coaches,
  gymTimezone = null,
  coachMode = null,
  onOwnOnlyRefused,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: (warning?: string) => void;
  editingClass: ClassRow | null;
  coaches: CoachRow[];
  gymTimezone?: string | null;
  /** Story 29.3 (UX AD-19 Coach mode): the signed-in Coach, resolved on the server (never typed by the user). Coach is then plain text, not a
   * select, and the class is saved with this id. Null for Manager, Supervisor and Owner, who keep the full select. */
  coachMode?: { id: string; name: string } | null;
  /** Story 29.3: called when the server refuses a Coach on a class that is not theirs (a stale tab after a reassignment); the message is shown
   * in the modal and the caller refreshes its list. */
  onOwnOnlyRefused?: () => void;
}) {
  const { t, i18n } = useTranslation();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [form, setForm] = useState(emptyForm);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Story 29.2: the weekly-times editor's own state (rows live in `form.rows`).
  const [showTimeErrors, setShowTimeErrors] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [focusKey, setFocusKey] = useState<string | null>(null);
  // Story 29.2: after an edit the modal shows the sessions the edit left unchanged, in place of the form.
  const [result, setResult] = useState<{ leftUnchanged: LeftUnchangedSession[]; summary: string | null; warning?: string } | null>(null);
  const resultHeadingRef = useRef<HTMLHeadingElement>(null);

  // Adjusted during render, matching PlanModal's own documented rationale --
  // catches editingClass changing reference while the dialog is already
  // open, not just the (open) transition.
  const [syncedWith, setSyncedWith] = useState<{ open: boolean; editingClass: ClassRow | null }>({
    open: false,
    editingClass: null,
  });
  if (open && (!syncedWith.open || syncedWith.editingClass !== editingClass)) {
    setSyncedWith({ open, editingClass });
    setForm({ ...formFromClass(editingClass), ...(coachMode ? { coachId: coachMode.id } : {}) });
    setFieldErrors({});
    setFormError(null);
    setShowTimeErrors(false);
    setAnnouncement("");
    setFocusKey(null);
    setResult(null);
  } else if (!open && syncedWith.open) {
    setSyncedWith({ open, editingClass });
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

  useEffect(() => {
    if (result) resultHeadingRef.current?.focus();
  }, [result]);

  const isRecurring = form.scheduleType === "recurring";
  const timesValidation = validateRows(form.rows);

  // Closing the result view (Done, the close button, Escape) is the end of a successful save: the list refreshes.
  function resetAndClose() {
    if (result) {
      onSaved(result.warning);
      return;
    }
    onClose();
  }

  function changeRow(key: string, patch: Partial<Pick<TimeRow, "weekday" | "time">>) {
    setAnnouncement("");
    setForm((prev) => ({ ...prev, rows: prev.rows.map((r) => (r.key === key ? { ...r, ...patch } : r)) }));
  }

  // A row that loses focus: its time is tidied ("7:00" -> "07:00") and the rows re-sort, Monday first, with a polite announcement.
  function blurRow(key: string) {
    setForm((prev) => {
      const tidied = prev.rows.map((r) => {
        if (r.key !== key) return r;
        const normalized = normalizeTime(r.time);
        return normalized !== null && normalized !== r.time ? { ...r, time: normalized } : r;
      });
      const sorted = sortRows(tidied);
      if (sorted !== tidied) setAnnouncement(t("classes.times.sorted"));
      return { ...prev, rows: sorted };
    });
  }

  function addRow() {
    if (isAtRowLimit(form.rows)) return;
    const row = nextRowAfter(form.rows, makeRowKey());
    setForm((prev) => ({ ...prev, rows: [...prev.rows, row] }));
    setFocusKey(row.key);
  }

  function removeRow(key: string) {
    setAnnouncement("");
    setForm((prev) => ({ ...prev, rows: prev.rows.filter((r) => r.key !== key) }));
  }

  function formatLeftRow(session: LeftUnchangedSession): string {
    const when = new Date(session.scheduledAt);
    const zone = gymTimezone ?? undefined;
    return t("classes.times.left.row", {
      day: new Intl.DateTimeFormat(i18n.language, { weekday: "short", timeZone: zone }).format(when),
      date: new Intl.DateTimeFormat(i18n.language, { day: "numeric", month: "short", timeZone: zone }).format(when),
      time: new Intl.DateTimeFormat(i18n.language, { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: zone }).format(when),
      n: session.bookedCount,
      capacity: session.capacity,
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); // validate on submit only, UX-DR11
    setFieldErrors({});
    setFormError(null);
    setShowTimeErrors(false);

    const preErrors: FieldErrors = {};

    if (form.name.trim() === "") {
      preErrors.name = t("classes.modal.errors.nameRequired");
    }
    if (!coachMode && form.coachId === "") {
      preErrors.coachId = t("classes.modal.errors.coachRequired");
    }

    const capacityNum = Number(form.capacity.trim());
    if (form.capacity.trim() === "" || !Number.isFinite(capacityNum) || !Number.isInteger(capacityNum) || capacityNum < 1) {
      preErrors.capacity = t("classes.modal.errors.capacityInvalid");
    }

    if (!isRecurring) {
      if (form.oneOffDate === "" || form.oneOffTime === "") {
        preErrors.oneOffSessionAt = t("classes.modal.errors.oneOffDateTimeRequired");
      } else if (!editingClass && new Date(`${form.oneOffDate}T${form.oneOffTime}`) <= new Date()) {
        // Only enforced on create -- an existing one-off class's session can
        // already be in the past (this schema has no delete path), and its
        // other fields must remain editable without being blocked by this
        // check (Review finding: editing an already-past one-off class must
        // not become impossible).
        preErrors.oneOffSessionAt = t("classes.modal.errors.oneOffDateTimeInPast");
      }
    } else {
      if (form.recurrenceStartDate === "") {
        preErrors.recurrenceStartDate = t("classes.modal.errors.recurringFieldsRequired");
      }
      if (timesValidation.hasErrors) {
        setShowTimeErrors(true);
      }
    }

    if (Object.keys(preErrors).length > 0 || (isRecurring && timesValidation.hasErrors)) {
      setFieldErrors(preErrors);
      return;
    }

    // Sort on save, with the same polite announcement as on blur.
    const sortedRows = sortRows(form.rows);
    if (isRecurring && sortedRows !== form.rows) {
      setForm((prev) => ({ ...prev, rows: sortedRows }));
      setAnnouncement(t("classes.times.sorted"));
    }

    let oneOffSessionAt: string | null = null;
    if (!isRecurring) {
      try {
        oneOffSessionAt = new Date(`${form.oneOffDate}T${form.oneOffTime}`).toISOString();
      } catch {
        setFieldErrors({ oneOffSessionAt: t("classes.modal.errors.oneOffDateTimeRequired") });
        return;
      }
    }

    const parsed = classSchema.safeParse({
      name: form.name,
      description: form.description.trim() === "" ? undefined : form.description,
      coachId: coachMode ? coachMode.id : form.coachId,
      capacity: capacityNum,
      scheduleType: form.scheduleType,
      oneOffSessionAt,
      slots: isRecurring ? rowsToSlots(sortedRows) : null,
      recurrenceStartDate: isRecurring ? form.recurrenceStartDate : null,
    });

    if (!parsed.success) {
      const errors: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0] as keyof FieldErrors;
        if (!errors[field]) errors[field] = t(FIELD_ERROR_KEY[field] ?? "common.invalidInput");
      }
      setFieldErrors(errors);
      return;
    }

    setSubmitting(true);
    try {
      const { data, error } = editingClass
        ? await editClass(editingClass.id, parsed.data)
        : await createClass(parsed.data);

      if (error) {
        // The class was actually saved -- only the audit entry failed to
        // write -- so this isn't a blocking error like the others below;
        // still close and refresh, just pass the warning along. Matches
        // PlanModal's established handling of the same error code (Review
        // fix: this previously called onSaved() with no argument, silently
        // discarding error.message -- the translated warning strings were
        // unreachable dead code).
        if (error.code === "audit_log_failed") {
          if (editingClass && hasLeftUnchanged(data)) {
            setResult({
              leftUnchanged: data.leftUnchanged,
              summary: parsed.data.slots ? summarizeSlots(parsed.data.slots, t).full : null,
              warning: error.message,
            });
            return;
          }
          onSaved(error.message);
          return;
        }
        setFormError(error.message);
        if (error.code === "class_coach_own_only") onOwnOnlyRefused?.();
        return;
      }

      if (editingClass && hasLeftUnchanged(data)) {
        setResult({
          leftUnchanged: data.leftUnchanged,
          summary: parsed.data.slots ? summarizeSlots(parsed.data.slots, t).full : null,
        });
        return;
      }

      onSaved();
    } catch {
      setFormError(t("common.somethingWentWrong"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      onClose={() => {
        if (open) resetAndClose();
      }}
      onCancel={(e) => {
        if (submitting) e.preventDefault();
      }}
      className="w-full max-w-[520px] rounded-md border bg-background p-0 text-foreground backdrop:bg-black/50"
    >
      {result ? (
        <div className="space-y-4 p-6" data-testid="class-saved-result">
          <div className="flex items-center justify-between">
            <h2 ref={resultHeadingRef} tabIndex={-1} className="text-lg font-semibold outline-none">
              {t("classes.times.saved.title")}
            </h2>
            <button
              type="button"
              aria-label={t("classes.modal.close")}
              onClick={resetAndClose}
              className="text-muted-foreground hover:text-foreground"
            >
              <X size={16} />
            </button>
          </div>
          {result.summary && <p className="text-sm">{t("classes.times.saved.summary", { summary: result.summary })}</p>}
          {result.leftUnchanged.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("classes.times.left.none")}</p>
          ) : (
            <div className="space-y-2">
              <p className="text-sm font-medium">
                {result.leftUnchanged.length === 1
                  ? t("classes.times.left.title1")
                  : t("classes.times.left.title", { n: result.leftUnchanged.length })}
              </p>
              <p className="text-sm text-muted-foreground">{t("classes.times.left.help")}</p>
              <ul className="space-y-1 text-sm">
                {result.leftUnchanged.map((session) => (
                  <li key={session.classSessionId}>{formatLeftRow(session)}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex justify-end pt-2">
            <Button type="button" onClick={resetAndClose}>
              {t("classes.times.done")}
            </Button>
          </div>
        </div>
      ) : (
      <form onSubmit={handleSubmit} className="space-y-4 p-6" noValidate>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            {editingClass
              ? t("classes.modal.editTitle", { name: editingClass.name })
              : t("classes.modal.addTitle")}
          </h2>
          <button
            type="button"
            aria-label={t("classes.modal.close")}
            onClick={resetAndClose}
            disabled={submitting}
            className="text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            <X size={16} />
          </button>
        </div>

        <div className="space-y-2">
          <Label htmlFor="className">{t("classes.modal.name")}</Label>
          <Input
            id="className"
            className="uppercase"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          {fieldErrors.name && <p className="text-sm text-red-600">{fieldErrors.name}</p>}
        </div>

        <div className="space-y-2">
          <Label htmlFor="classDescription">{t("classes.modal.description")}</Label>
          <Input
            id="classDescription"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </div>

        {coachMode ? (
          <div className="space-y-2">
            <p id="classCoachFixedLabel" className="text-sm font-medium leading-none">
              {t("classes.coach.fixed")}
            </p>
            <p
              data-testid="class-coach-fixed"
              role="group"
              aria-labelledby="classCoachFixedLabel"
              aria-describedby="classCoachFixedHelp"
              className="text-sm"
            >
              {coachMode.name}
            </p>
            <p id="classCoachFixedHelp" className="text-xs text-muted-foreground">
              {t("classes.coach.fixedHelp")}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            <Label htmlFor="classCoach">{t("classes.modal.coach")}</Label>
            <select
              id="classCoach"
              value={form.coachId}
              onChange={(e) => setForm({ ...form, coachId: e.target.value })}
              className={selectClassName}
            >
              <option value="">{t("classes.modal.coachPlaceholder")}</option>
              {coaches.map((coach) => (
                <option key={coach.id} value={coach.id}>
                  {coach.name}
                </option>
              ))}
            </select>
            {fieldErrors.coachId && <p className="text-sm text-red-600">{fieldErrors.coachId}</p>}
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="classCapacity">{t("classes.modal.capacity")}</Label>
          <Input
            id="classCapacity"
            type="number"
            min={1}
            value={form.capacity}
            onChange={(e) => setForm({ ...form, capacity: e.target.value })}
          />
          {fieldErrors.capacity && <p className="text-sm text-red-600">{fieldErrors.capacity}</p>}
        </div>

        <div className="space-y-2">
          <Label>{t("classes.modal.scheduleType")}</Label>
          <div className="flex gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="scheduleType"
                checked={!isRecurring}
                onChange={() => setForm({ ...form, scheduleType: "one_off" })}
              />
              {t("classes.modal.oneOff")}
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="scheduleType"
                checked={isRecurring}
                onChange={() => setForm({ ...form, scheduleType: "recurring" })}
              />
              {t("classes.modal.recurring")}
            </label>
          </div>
        </div>

        {!isRecurring ? (
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="oneOffDate">{t("classes.modal.date")}</Label>
              <Input
                id="oneOffDate"
                type="date"
                value={form.oneOffDate}
                onChange={(e) => setForm({ ...form, oneOffDate: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="oneOffTime">{t("classes.modal.time")}</Label>
              <Input
                id="oneOffTime"
                type="time"
                value={form.oneOffTime}
                onChange={(e) => setForm({ ...form, oneOffTime: e.target.value })}
              />
            </div>
            {fieldErrors.oneOffSessionAt && (
              <p className="col-span-2 text-sm text-red-600">{fieldErrors.oneOffSessionAt}</p>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="recurrenceStartDate">{t("classes.modal.startDate")}</Label>
              <Input
                id="recurrenceStartDate"
                type="date"
                value={form.recurrenceStartDate}
                onChange={(e) => setForm({ ...form, recurrenceStartDate: e.target.value })}
              />
              {fieldErrors.recurrenceStartDate && (
                <p className="text-sm text-red-600">{fieldErrors.recurrenceStartDate}</p>
              )}
            </div>
            {showTimeErrors && timesValidation.hasErrors && (
              <p role="alert" className="text-sm text-red-600">
                {t("classes.times.error.summary")}
              </p>
            )}
            <WeeklyTimesEditor
              rows={form.rows}
              validation={timesValidation}
              showErrors={showTimeErrors}
              timezone={gymTimezone}
              editNotice={Boolean(editingClass?.nextSessionId)}
              announcement={announcement}
              focusKey={focusKey}
              onRowChange={changeRow}
              onRowBlur={blurRow}
              onAdd={addRow}
              onRemove={removeRow}
            />
          </div>
        )}

        {formError && <p className="text-sm text-red-600">{formError}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={resetAndClose} disabled={submitting}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting
              ? t("common.saving")
              : editingClass
                ? t("classes.modal.saveChanges")
                : t("classes.addClassButton")}
          </Button>
        </div>
      </form>
      )}
    </dialog>
  );
}
