"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { classSchema } from "@gymos/types";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ClassRow } from "@/services/classes";
import type { CoachRow } from "@/services/coaches";
import { createClass, editClass } from "../actions";

type ScheduleType = ClassRow["scheduleType"];

interface FieldErrors {
  name?: string;
  coachId?: string;
  capacity?: string;
  oneOffSessionAt?: string;
  recurrenceDays?: string;
  recurrenceTime?: string;
  recurrenceStartDate?: string;
}

const FIELD_ERROR_KEY: Record<keyof FieldErrors, string> = {
  name: "classes.modal.errors.nameRequired",
  coachId: "classes.modal.errors.coachRequired",
  capacity: "classes.modal.errors.capacityInvalid",
  oneOffSessionAt: "classes.modal.errors.oneOffDateTimeRequired",
  recurrenceDays: "classes.modal.errors.recurringFieldsRequired",
  recurrenceTime: "classes.modal.errors.recurringFieldsRequired",
  recurrenceStartDate: "classes.modal.errors.recurringFieldsRequired",
};

const DAY_TOGGLES: { value: number; key: string }[] = [
  { value: 0, key: "classes.days.sun" },
  { value: 1, key: "classes.days.mon" },
  { value: 2, key: "classes.days.tue" },
  { value: 3, key: "classes.days.wed" },
  { value: 4, key: "classes.days.thu" },
  { value: 5, key: "classes.days.fri" },
  { value: 6, key: "classes.days.sat" },
];

const emptyForm = {
  name: "",
  description: "",
  coachId: "",
  capacity: "",
  scheduleType: "one_off" as ScheduleType,
  oneOffDate: "",
  oneOffTime: "",
  recurrenceDays: [] as number[],
  recurrenceTime: "",
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
  if (!cls) return emptyForm;
  return {
    name: cls.name,
    description: cls.description ?? "",
    coachId: cls.coachId,
    capacity: String(cls.capacity),
    scheduleType: cls.scheduleType,
    oneOffDate: cls.oneOffSessionAt ? toDateInputValue(cls.oneOffSessionAt) : "",
    oneOffTime: cls.oneOffSessionAt ? toTimeInputValue(cls.oneOffSessionAt) : "",
    recurrenceDays: cls.recurrenceDays ?? [],
    // Postgres's `time` column round-trips as "HH:mm:ss" (e.g. "18:00:00"),
    // but the <input type="time"> value and classSchema's own regex both
    // expect "HH:mm" -- left un-normalized, an edit submitted without
    // retouching the time field failed validation silently (no visible
    // per-field error was ever rendered for this field), matching
    // toDateInputValue/toTimeInputValue's own local-formatting discipline
    // for the one-off fields just above.
    recurrenceTime: cls.recurrenceTime ? cls.recurrenceTime.slice(0, 5) : "",
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
}: {
  open: boolean;
  onClose: () => void;
  onSaved: (warning?: string) => void;
  editingClass: ClassRow | null;
  coaches: CoachRow[];
}) {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [form, setForm] = useState(emptyForm);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Adjusted during render, matching PlanModal's own documented rationale --
  // catches editingClass changing reference while the dialog is already
  // open, not just the (open) transition.
  const [syncedWith, setSyncedWith] = useState<{ open: boolean; editingClass: ClassRow | null }>({
    open: false,
    editingClass: null,
  });
  if (open && (!syncedWith.open || syncedWith.editingClass !== editingClass)) {
    setSyncedWith({ open, editingClass });
    setForm(formFromClass(editingClass));
    setFieldErrors({});
    setFormError(null);
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

  const isRecurring = form.scheduleType === "recurring";

  function resetAndClose() {
    onClose();
  }

  function toggleDay(day: number) {
    setForm((prev) => ({
      ...prev,
      recurrenceDays: prev.recurrenceDays.includes(day)
        ? prev.recurrenceDays.filter((d) => d !== day)
        : [...prev.recurrenceDays, day].sort((a, b) => a - b),
    }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); // validate on submit only, UX-DR11
    setFieldErrors({});
    setFormError(null);

    const preErrors: FieldErrors = {};

    if (form.name.trim() === "") {
      preErrors.name = t("classes.modal.errors.nameRequired");
    }
    if (form.coachId === "") {
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
      if (form.recurrenceDays.length === 0 || form.recurrenceTime === "" || form.recurrenceStartDate === "") {
        preErrors.recurrenceDays = t("classes.modal.errors.recurringFieldsRequired");
      }
    }

    if (Object.keys(preErrors).length > 0) {
      setFieldErrors(preErrors);
      return;
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
      coachId: form.coachId,
      capacity: capacityNum,
      scheduleType: form.scheduleType,
      oneOffSessionAt,
      recurrenceDays: isRecurring ? form.recurrenceDays : null,
      recurrenceTime: isRecurring ? form.recurrenceTime : null,
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
      const { error } = editingClass
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
          onSaved(error.message);
          return;
        }
        setFormError(error.message);
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
      onClose={resetAndClose}
      onCancel={(e) => {
        if (submitting) e.preventDefault();
      }}
      className="w-full max-w-[520px] rounded-md border bg-background p-0 text-foreground backdrop:bg-black/50"
    >
      <form onSubmit={handleSubmit} className="space-y-4 p-6">
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
              <Label>{t("classes.modal.daysOfWeek")}</Label>
              <div className="flex flex-wrap gap-3">
                {DAY_TOGGLES.map((day) => (
                  <label key={day.value} className="flex items-center gap-1 text-sm">
                    <input
                      type="checkbox"
                      checked={form.recurrenceDays.includes(day.value)}
                      onChange={() => toggleDay(day.value)}
                    />
                    {t(day.key)}
                  </label>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="recurrenceTime">{t("classes.modal.time")}</Label>
                <Input
                  id="recurrenceTime"
                  type="time"
                  value={form.recurrenceTime}
                  onChange={(e) => setForm({ ...form, recurrenceTime: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="recurrenceStartDate">{t("classes.modal.startDate")}</Label>
                <Input
                  id="recurrenceStartDate"
                  type="date"
                  value={form.recurrenceStartDate}
                  onChange={(e) => setForm({ ...form, recurrenceStartDate: e.target.value })}
                />
              </div>
            </div>
            {(fieldErrors.recurrenceDays || fieldErrors.recurrenceTime || fieldErrors.recurrenceStartDate) && (
              <p className="text-sm text-red-600">
                {fieldErrors.recurrenceDays || fieldErrors.recurrenceTime || fieldErrors.recurrenceStartDate}
              </p>
            )}
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
    </dialog>
  );
}
