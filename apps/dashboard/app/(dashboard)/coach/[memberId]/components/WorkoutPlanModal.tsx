"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { workoutPlanSchema } from "@gymos/types";
import { ArrowDown, ArrowUp, GripVertical, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ExerciseLibraryRow } from "@/services/exercises";
import type { WorkoutPlanRow } from "@/services/workoutPlans";
import { addCustomExerciseAction, createWorkoutPlanAction, updateWorkoutPlanAction } from "../actions";

const selectClassName =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

interface RowState {
  key: string;
  exerciseId: string;
  sets: string;
  reps: string;
  note: string;
}

function emptyRow(): RowState {
  return { key: crypto.randomUUID(), exerciseId: "", sets: "", reps: "", note: "" };
}

/**
 * Plan create/edit modal (EXPERIENCE.md AD-15 Workout Plan tab, Story 13.2).
 * One component handles both create (`plan` prop null) and edit (`plan`
 * prop set) -- same `<dialog>` pattern as `SessionNoteModal.tsx`. Exercises
 * are picked from `exerciseLibrary` via a plain `<select>` (`ClassModal.tsx`'s
 * own precedent, `selectClassName` copied per-file) -- no free-typing an
 * exercise name outside the library, no new searchable-select primitive.
 */
export function WorkoutPlanModal({
  memberId,
  plan,
  exerciseLibrary: initialExerciseLibrary,
  onClose,
  onSaved,
}: {
  memberId: string;
  plan: WorkoutPlanRow | null;
  exerciseLibrary: ExerciseLibraryRow[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const isEdit = plan !== null;

  const [name, setName] = useState(plan?.name ?? "");
  const [rows, setRows] = useState<RowState[]>(
    plan && plan.exercises.length > 0
      ? plan.exercises.map((e) => ({
          key: crypto.randomUUID(),
          exerciseId: e.exerciseId,
          sets: String(e.sets),
          reps: String(e.reps),
          note: e.note ?? "",
        }))
      : [emptyRow()],
  );
  const [exerciseLibrary, setExerciseLibrary] = useState<ExerciseLibraryRow[]>(initialExerciseLibrary);

  const [nameError, setNameError] = useState<string | null>(null);
  const [exercisesError, setExercisesError] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, Partial<Record<keyof RowState, string>>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [newExerciseDraftKey, setNewExerciseDraftKey] = useState<string | null>(null);
  const [newExerciseName, setNewExerciseName] = useState("");
  const [newExerciseError, setNewExerciseError] = useState<string | null>(null);
  const [newExerciseSubmitting, setNewExerciseSubmitting] = useState(false);

  const dragIndexRef = useRef<number | null>(null);

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  function resetAndClose() {
    onClose();
  }

  function updateRow(key: string, patch: Partial<RowState>) {
    setRows((prev) => prev.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  function removeRow(key: string) {
    setRows((prev) => prev.filter((row) => row.key !== key));
  }

  function addRow() {
    setRows((prev) => [...prev, emptyRow()]);
  }

  function moveRow(index: number, direction: -1 | 1) {
    setRows((prev) => {
      const target = index + direction;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function handleDrop(targetIndex: number) {
    const sourceIndex = dragIndexRef.current;
    dragIndexRef.current = null;
    if (sourceIndex === null || sourceIndex === targetIndex) return;
    setRows((prev) => {
      // rows may have shrunk (a row removed via its X button) between
      // drag-start and drop -- a stale index must not splice past the
      // current array bounds.
      if (sourceIndex < 0 || sourceIndex >= prev.length || targetIndex < 0 || targetIndex >= prev.length) {
        return prev;
      }
      const next = [...prev];
      const [moved] = next.splice(sourceIndex, 1);
      next.splice(targetIndex, 0, moved);
      return next;
    });
  }

  function exerciseNameFor(exerciseId: string): string {
    return exerciseLibrary.find((ex) => ex.id === exerciseId)?.name ?? t("coachPortal.detail.workoutPlanTab.unnamedRow");
  }

  async function confirmNewExercise(rowKey: string) {
    setNewExerciseError(null);
    setNewExerciseSubmitting(true);
    try {
      const { data, error } = await addCustomExerciseAction({ name: newExerciseName });

      if (error || !data) {
        // exercise_name_taken shows inline rather than silently failing --
        // no auto-select of an existing match on the caller's behalf,
        // ambiguous which one the coach meant.
        setNewExerciseError(error?.message ?? t("common.invalidInput"));
        return;
      }

      setExerciseLibrary((prev) => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)));
      updateRow(rowKey, { exerciseId: data.id });
      setNewExerciseDraftKey(null);
      setNewExerciseName("");
    } catch {
      setNewExerciseError(t("common.somethingWentWrong"));
    } finally {
      setNewExerciseSubmitting(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setNameError(null);
    setExercisesError(null);
    setRowErrors({});
    setFormError(null);

    const exercises = rows.map((row) => ({
      exerciseId: row.exerciseId,
      sets: Number(row.sets),
      reps: Number(row.reps),
      note: row.note.trim() === "" ? null : row.note,
    }));

    const parsed = workoutPlanSchema.safeParse({ name, exercises });
    if (!parsed.success) {
      const nextRowErrors: Record<string, Partial<Record<keyof RowState, string>>> = {};
      for (const issue of parsed.error.issues) {
        const [field, index, subField] = issue.path;
        if (field === "name") {
          setNameError(t("coachPortal.detail.workoutPlanTab.errors.nameRequired"));
        } else if (field === "exercises" && index === undefined) {
          setExercisesError(
            t(
              issue.code === "too_big"
                ? "coachPortal.detail.workoutPlanTab.errors.tooManyExercises"
                : "coachPortal.detail.workoutPlanTab.errors.exercisesRequired",
            ),
          );
        } else if (field === "exercises" && typeof index === "number") {
          const row = rows[index];
          if (!row) continue;
          const key = subField as keyof RowState;
          const tooLarge = issue.code === "too_big";
          const errorKey =
            key === "exerciseId"
              ? "coachPortal.detail.workoutPlanTab.errors.exerciseRequired"
              : key === "sets"
                ? tooLarge
                  ? "coachPortal.detail.workoutPlanTab.errors.setsTooLarge"
                  : "coachPortal.detail.workoutPlanTab.errors.setsInvalid"
                : key === "reps"
                  ? tooLarge
                    ? "coachPortal.detail.workoutPlanTab.errors.repsTooLarge"
                    : "coachPortal.detail.workoutPlanTab.errors.repsInvalid"
                  : "coachPortal.detail.workoutPlanTab.errors.noteTooLong";
          nextRowErrors[row.key] = { ...nextRowErrors[row.key], [key]: t(errorKey) };
        }
      }
      setRowErrors(nextRowErrors);
      return;
    }

    setSubmitting(true);
    try {
      const { error } = isEdit
        ? await updateWorkoutPlanAction({ planId: plan.id, name: parsed.data.name, exercises: parsed.data.exercises })
        : await createWorkoutPlanAction({ memberId, name: parsed.data.name, exercises: parsed.data.exercises });

      if (error) {
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
        if (submitting || newExerciseSubmitting) e.preventDefault();
      }}
      className="w-full max-w-[560px] rounded-md border bg-background p-0 text-foreground backdrop:bg-black/50"
    >
      <form onSubmit={handleSubmit} className="max-h-[85vh] space-y-4 overflow-y-auto p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            {isEdit
              ? t("coachPortal.detail.workoutPlanTab.editTitle")
              : t("coachPortal.detail.workoutPlanTab.addTitle")}
          </h2>
          <button
            type="button"
            aria-label={t("coachPortal.detail.workoutPlanTab.cancel")}
            onClick={resetAndClose}
            disabled={submitting}
            className="text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            <X size={16} />
          </button>
        </div>

        <div className="space-y-2">
          <Label htmlFor="workoutPlanName">{t("coachPortal.detail.workoutPlanTab.nameLabel")}</Label>
          <Input id="workoutPlanName" value={name} onChange={(e) => setName(e.target.value)} disabled={submitting} />
          {nameError && <p className="text-sm text-red-600">{nameError}</p>}
        </div>

        <div className="space-y-3">
          <Label>{t("coachPortal.detail.workoutPlanTab.exercisesLabel")}</Label>
          {exercisesError && <p className="text-sm text-red-600">{exercisesError}</p>}

          {rows.map((row, index) => (
            <div key={row.key} className="space-y-2 rounded-md border p-3">
              <div className="flex items-start gap-2">
                <div
                  draggable
                  onDragStart={() => {
                    dragIndexRef.current = index;
                  }}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => handleDrop(index)}
                  className="mt-1.5 cursor-grab text-muted-foreground"
                  aria-hidden="true"
                >
                  <GripVertical size={16} />
                </div>

                <div className="flex-1 space-y-2">
                  <select
                    value={row.exerciseId}
                    onChange={(e) => updateRow(row.key, { exerciseId: e.target.value })}
                    disabled={submitting}
                    className={selectClassName}
                  >
                    <option value="">{t("coachPortal.detail.workoutPlanTab.exercisePlaceholder")}</option>
                    {exerciseLibrary.map((ex) => (
                      <option key={ex.id} value={ex.id}>
                        {ex.name}
                      </option>
                    ))}
                  </select>
                  {rowErrors[row.key]?.exerciseId && (
                    <p className="text-sm text-red-600">{rowErrors[row.key].exerciseId}</p>
                  )}

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Input
                        type="number"
                        min={1}
                        placeholder={t("coachPortal.detail.workoutPlanTab.setsLabel")}
                        value={row.sets}
                        onChange={(e) => updateRow(row.key, { sets: e.target.value })}
                        disabled={submitting}
                      />
                      {rowErrors[row.key]?.sets && <p className="text-sm text-red-600">{rowErrors[row.key].sets}</p>}
                    </div>
                    <div>
                      <Input
                        type="number"
                        min={1}
                        placeholder={t("coachPortal.detail.workoutPlanTab.repsLabel")}
                        value={row.reps}
                        onChange={(e) => updateRow(row.key, { reps: e.target.value })}
                        disabled={submitting}
                      />
                      {rowErrors[row.key]?.reps && <p className="text-sm text-red-600">{rowErrors[row.key].reps}</p>}
                    </div>
                  </div>

                  <Input
                    placeholder={t("coachPortal.detail.workoutPlanTab.noteLabel")}
                    value={row.note}
                    onChange={(e) => updateRow(row.key, { note: e.target.value })}
                    disabled={submitting}
                  />
                  {rowErrors[row.key]?.note && <p className="text-sm text-red-600">{rowErrors[row.key].note}</p>}

                  {newExerciseDraftKey === row.key ? (
                    <div className="flex items-center gap-2">
                      <Input
                        autoFocus
                        value={newExerciseName}
                        onChange={(e) => setNewExerciseName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            if (!newExerciseSubmitting && newExerciseName.trim() !== "") {
                              confirmNewExercise(row.key);
                            }
                          }
                        }}
                        placeholder={t("coachPortal.detail.workoutPlanTab.newExercisePlaceholder")}
                        disabled={newExerciseSubmitting}
                      />
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={newExerciseSubmitting || newExerciseName.trim() === ""}
                        onClick={() => confirmNewExercise(row.key)}
                      >
                        {newExerciseSubmitting
                          ? t("coachPortal.detail.workoutPlanTab.saving")
                          : t("coachPortal.detail.workoutPlanTab.confirmNewExercise")}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={newExerciseSubmitting}
                        onClick={() => {
                          setNewExerciseDraftKey(null);
                          setNewExerciseName("");
                          setNewExerciseError(null);
                        }}
                      >
                        {t("coachPortal.detail.workoutPlanTab.cancel")}
                      </Button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setNewExerciseDraftKey(row.key);
                        setNewExerciseName("");
                        setNewExerciseError(null);
                      }}
                      disabled={submitting}
                      className="text-xs text-primary hover:underline"
                    >
                      {t("coachPortal.detail.workoutPlanTab.addNewExerciseLabel")}
                    </button>
                  )}
                  {newExerciseDraftKey === row.key && newExerciseError && (
                    <p className="text-sm text-red-600">{newExerciseError}</p>
                  )}
                </div>

                <div className="flex flex-col gap-1">
                  <button
                    type="button"
                    aria-label={t("coachPortal.detail.workoutPlanTab.moveUp", { exercise: exerciseNameFor(row.exerciseId) })}
                    onClick={() => moveRow(index, -1)}
                    disabled={submitting || index === 0}
                    className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                  >
                    <ArrowUp size={14} />
                  </button>
                  <button
                    type="button"
                    aria-label={t("coachPortal.detail.workoutPlanTab.moveDown", { exercise: exerciseNameFor(row.exerciseId) })}
                    onClick={() => moveRow(index, 1)}
                    disabled={submitting || index === rows.length - 1}
                    className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                  >
                    <ArrowDown size={14} />
                  </button>
                  <button
                    type="button"
                    aria-label={t("coachPortal.detail.workoutPlanTab.removeRow", { exercise: exerciseNameFor(row.exerciseId) })}
                    onClick={() => removeRow(row.key)}
                    disabled={submitting}
                    className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>
            </div>
          ))}

          <Button type="button" variant="outline" size="sm" onClick={addRow} disabled={submitting}>
            {t("coachPortal.detail.workoutPlanTab.addExerciseButton")}
          </Button>
        </div>

        {formError && <p className="text-sm text-red-600">{formError}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={resetAndClose} disabled={submitting}>
            {t("coachPortal.detail.workoutPlanTab.cancel")}
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? t("coachPortal.detail.workoutPlanTab.saving") : t("coachPortal.detail.workoutPlanTab.save")}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
